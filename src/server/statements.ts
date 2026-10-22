/**
 * 単価と稼働明細
 *
 * - 明細は「承認済みの日報」と「適用期間付きの単価」から作る。予定スケジュールだけでは作らない
 * - 単価方式: 日額 / 時間単価 / 件数単価 / 固定月額。承認済みの加算・調整を含める
 * - 1ドライバー×1か月の有効な明細は1件（DBの一意制約）
 * - 再生成は下書き・確認中だけ置き換える（何度実行しても同じ結果・重複しない）
 * - 確定時に単価・数量・税設定・源泉設定を明細行とスナップショットに保存し、DBトリガーで金額を固定する。
 *   後で単価を変えても過去の明細は変わらない。訂正は新しい版（訂正版）を作る
 * - 立替経費は「稼働明細で精算」を選んだ承認済み経費だけを含め、経費1件につき明細行は1つ（DBの一意制約）。
 *   経費の計上は経費として1回だけ行い、明細の立替経費行は支払のためだけに使う（外注費に加えない）
 * - 源泉徴収はドライバーごとの「確認済み」設定がある場合だけ計算する（一律には適用しない）
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, dailyReport, division, driver, expense, payable, project, rate, statement, statementAdjustment, statementInquiry, statementLine } from "@/db/schema";
import { type Actor, can, canAccessDivision, divisionScope } from "@/lib/access";
import { DATE_RE, monthRange, MONTH_RE } from "@/lib/dates";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { lineAmount, roundYen, taxFromGross, taxFromNet, type Rounding } from "@/lib/money";
import { writeAudit } from "./audit";
import { getSettings } from "./masters";
import { parse, zText, zYen } from "./validate";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const RATE_UNIT: Record<string, string> = { DAILY: "日", HOURLY: "時間", PER_UNIT: "件", MONTHLY: "月" };

/* ================================================================== */
/* 単価                                                                 */
/* ================================================================== */

const rateInput = z.object({
  projectId: z.string().uuid("案件を選んでください"),
  driverId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  method: z.enum(["DAILY", "HOURLY", "PER_UNIT", "MONTHLY"]),
  unitPrice: zYen("単価"),
  unitLabel: z.string().trim().max(10).default(""),
  effectiveFrom: z.string().regex(DATE_RE, "適用開始日を入力してください"),
});

/** 単価の追加。同じ案件×ドライバーの直前の単価は開始日の前日で終了する。確定済み明細に使われた期間には遡らせない */
export async function addRate(db: DB, actor: Actor, raw: z.input<typeof rateInput>) {
  const input = parse(rateInput, raw);
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(project).where(eq(project.id, input.projectId)).limit(1);
    if (!p || actor.role === "DRIVER" || !canAccessDivision(actor, p.divisionId)) throw notFound("案件が見つかりません");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rate:${input.projectId}:${input.driverId ?? "*"}`}))`);
    const same = and(eq(rate.projectId, input.projectId), input.driverId ? eq(rate.driverId, input.driverId) : isNull(rate.driverId));
    const [latest] = await tx.select().from(rate).where(same).orderBy(desc(rate.effectiveFrom)).limit(1);
    if (latest) {
      if (input.effectiveFrom <= latest.effectiveFrom) throw invalid(`適用開始日は現在の単価の開始日（${latest.effectiveFrom}）より後にしてください`);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(statementLine)
        .innerJoin(statement, eq(statement.id, statementLine.statementId))
        .where(and(eq(statementLine.rateId, latest.id), inArray(statement.status, ["CONFIRMED", "PUBLISHED"]), gte(statementLine.workDate, input.effectiveFrom)));
      if (n > 0) throw invalid("確定済みの稼働明細に使われた期間へ遡って単価を変えることはできません");
      await tx.update(rate).set({ effectiveTo: sql`${input.effectiveFrom}::date - 1` }).where(and(eq(rate.id, latest.id), or(isNull(rate.effectiveTo), gte(rate.effectiveTo, input.effectiveFrom))));
    }
    const [r] = await tx.insert(rate).values({ ...input, driverId: input.driverId ?? null, unitLabel: input.unitLabel || RATE_UNIT[input.method], createdById: actor.userId }).returning({ id: rate.id });
    await writeAudit(tx, actor, { action: "rate.create", entityType: "rate", entityId: r.id, divisionId: p.divisionId, summary: `${p.code} の単価を ${input.effectiveFrom} から設定（${input.method} ${input.unitPrice}円）`, changes: input });
    return r.id;
  });
}

export async function listRates(db: DB, actor: Actor, projectId?: string) {
  const scope = divisionScope(actor);
  return db
    .select({ r: rate, projectCode: project.code, projectName: project.name, driverName: appUser.name })
    .from(rate)
    .innerJoin(project, eq(project.id, rate.projectId))
    .leftJoin(appUser, eq(appUser.id, rate.driverId))
    .where(and(projectId ? eq(rate.projectId, projectId) : undefined, scope ? (scope.length ? inArray(project.divisionId, scope) : sql`false`) : undefined))
    .orderBy(asc(project.code), asc(appUser.name), desc(rate.effectiveFrom));
}

async function findRate(tx: Tx, projectId: string, driverId: string, day: string) {
  const rows = await tx
    .select()
    .from(rate)
    .where(and(eq(rate.projectId, projectId), or(eq(rate.driverId, driverId), isNull(rate.driverId)), lte(rate.effectiveFrom, day), or(isNull(rate.effectiveTo), gte(rate.effectiveTo, day))));
  // ドライバー個別の単価を優先
  return rows.find((r) => r.driverId === driverId) ?? rows.find((r) => r.driverId === null) ?? null;
}

/* ================================================================== */
/* 加算・調整                                                           */
/* ================================================================== */

export async function addAdjustment(db: DB, actor: Actor, raw: { driverId: string; projectId?: string; month: string; amount: string; reason: string }) {
  if (actor.role === "DRIVER") throw forbidden();
  const month = parse(z.string().regex(MONTH_RE, "対象月を選んでください"), raw.month);
  const amount = parse(zYen("金額", { allowNegative: true, min: -10_000_000 }), raw.amount);
  if (amount === 0) throw invalid("金額を入力してください");
  const reason = parse(zText("理由", 300), raw.reason);
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(driver).where(eq(driver.userId, raw.driverId)).limit(1);
    if (!d || !canAccessDivision(actor, d.divisionId)) throw notFound("ドライバーが見つかりません");
    const [a] = await tx.insert(statementAdjustment).values({ driverId: raw.driverId, projectId: raw.projectId || null, divisionId: d.divisionId, month, amount, reason, createdById: actor.userId }).returning({ id: statementAdjustment.id });
    await writeAudit(tx, actor, { action: "adjustment.create", entityType: "statement_adjustment", entityId: a.id, divisionId: d.divisionId, summary: `${month} の調整 ${amount}円を登録（承認待ち）: ${reason}` });
    return a.id;
  });
}

export async function decideAdjustment(db: DB, actor: Actor, id: string, approve: boolean) {
  if (!can.manageAccounting(actor) && actor.role !== "MANAGER") throw forbidden();
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(statementAdjustment).where(eq(statementAdjustment.id, id)).for("update");
    if (!a || !canAccessDivision(actor, a.divisionId)) throw notFound();
    if (a.createdById === actor.userId) throw forbidden("自分で登録した調整は承認できません");
    if (a.status !== "PENDING") throw conflict("この調整は既に処理されています");
    await tx.update(statementAdjustment).set({ status: approve ? "APPROVED" : "REJECTED", approvedById: actor.userId, approvedAt: new Date() }).where(eq(statementAdjustment.id, id));
    await writeAudit(tx, actor, { action: approve ? "adjustment.approve" : "adjustment.reject", entityType: "statement_adjustment", entityId: id, divisionId: a.divisionId, summary: `調整 ${a.amount}円を${approve ? "承認" : "却下"}` });
  });
}

export async function listAdjustments(db: DB, actor: Actor, month?: string) {
  const scope = divisionScope(actor);
  return db
    .select({ a: statementAdjustment, driverName: appUser.name })
    .from(statementAdjustment)
    .innerJoin(appUser, eq(appUser.id, statementAdjustment.driverId))
    .where(and(month ? eq(statementAdjustment.month, month) : undefined, scope ? (scope.length ? inArray(statementAdjustment.divisionId, scope) : sql`false`) : undefined))
    .orderBy(desc(statementAdjustment.createdAt))
    .limit(200);
}

/* ================================================================== */
/* 明細の生成                                                           */
/* ================================================================== */

type BuiltLine = Omit<typeof statementLine.$inferInsert, "statementId">;

function withholdingOf(base: number) {
  // 確認済み設定のドライバーのみ: 100万円以下 10.21%、超える部分 20.42%（設定内容は確定時に保存）
  if (base <= 0) return 0;
  if (base <= 1_000_000) return Math.floor((base * 1021) / 10000);
  return Math.floor(((base - 1_000_000) * 2042) / 10000) + 102100;
}

async function buildLines(tx: Tx, driverId: string, month: string, rounding: Rounding) {
  const [from, to] = monthRange(month);
  const reports = await tx
    .select({ r: dailyReport, p: project })
    .from(dailyReport)
    .innerJoin(project, eq(project.id, dailyReport.projectId))
    .where(and(eq(dailyReport.driverId, driverId), eq(dailyReport.status, "APPROVED"), gte(dailyReport.workDate, from), lte(dailyReport.workDate, to)))
    .orderBy(asc(dailyReport.workDate), asc(dailyReport.startTime));
  const lines: BuiltLine[] = [];
  const warnings: string[] = [];
  const reportIds: string[] = [];
  const monthlyDone = new Set<string>();
  for (const { r, p } of reports) {
    const rt = await findRate(tx, p.id, driverId, r.workDate);
    if (!rt) {
      warnings.push(`${r.workDate} ${p.code}: 単価が設定されていないため明細に含めていません`);
      continue;
    }
    reportIds.push(r.id);
    const minutes = toMin(r.endTime) - toMin(r.startTime) - r.breakMinutes;
    let quantity = "1";
    let amount = rt.unitPrice;
    let description = `${p.name}`;
    if (rt.method === "HOURLY") {
      quantity = (Math.round((minutes / 60) * 100) / 100).toFixed(2);
      amount = roundYen(minutes * rt.unitPrice, 60, rounding);
      description += `（${r.startTime.slice(0, 5)}〜${r.endTime.slice(0, 5)}${r.breakMinutes ? ` 休憩${r.breakMinutes}分` : ""}）`;
    } else if (rt.method === "PER_UNIT") {
      if (!r.quantity) {
        warnings.push(`${r.workDate} ${p.code}: 件数単価ですが実績数量がありません`);
        reportIds.pop();
        continue;
      }
      quantity = r.quantity;
      amount = lineAmount(r.quantity, rt.unitPrice);
    } else if (rt.method === "MONTHLY") {
      if (monthlyDone.has(p.id)) continue; // 固定月額は案件ごとに1行
      monthlyDone.add(p.id);
      description += `（${month} 固定月額）`;
    }
    lines.push({ kind: "WORK", divisionId: p.divisionId, projectId: p.id, workDate: rt.method === "MONTHLY" ? null : r.workDate, description, quantity, unit: rt.unitLabel || RATE_UNIT[rt.method], unitPrice: rt.unitPrice, amount, rateId: rt.id, reportId: r.id, sortOrder: lines.length });
  }
  const adjs = await tx.select().from(statementAdjustment).where(and(eq(statementAdjustment.driverId, driverId), eq(statementAdjustment.month, month), eq(statementAdjustment.status, "APPROVED")));
  for (const a of adjs) lines.push({ kind: "ADJUSTMENT", divisionId: a.divisionId, projectId: a.projectId, workDate: null, description: `調整: ${a.reason}`, quantity: "1", unit: "式", unitPrice: a.amount, amount: a.amount, adjustmentId: a.id, sortOrder: lines.length });
  // 立替経費: 稼働明細で精算する承認済み経費のうち、まだどの明細にも入っていないもの（対象月以前の利用分）
  const exps = await tx
    .select()
    .from(expense)
    .where(and(eq(expense.applicantId, driverId), eq(expense.status, "APPROVED"), eq(expense.settlement, "STATEMENT"), isNull(expense.statementLineId), lte(expense.month, month)))
    .orderBy(asc(expense.usedOn));
  for (const e of exps) lines.push({ kind: "EXPENSE", divisionId: e.divisionId!, projectId: e.projectId, workDate: e.usedOn, description: `立替経費: ${e.payee}（${e.purpose}）`, quantity: "1", unit: "件", unitPrice: e.amount, amount: e.amount, expenseId: e.id, sortOrder: lines.length });
  return { lines, warnings, reportIds };
}

function totals(lines: BuiltLine[], taxMode: string, withholding: boolean, rounding: Rounding) {
  const work = lines.filter((l) => l.kind === "WORK").reduce((s, l) => s + l.amount, 0);
  const adj = lines.filter((l) => l.kind === "ADJUSTMENT").reduce((s, l) => s + l.amount, 0);
  const exp = lines.filter((l) => l.kind === "EXPENSE").reduce((s, l) => s + l.amount, 0);
  const base = work + adj;
  const tax = taxMode === "EXCLUSIVE" ? taxFromNet(Math.max(0, base), 10, rounding) : taxMode === "INCLUSIVE" ? taxFromGross(Math.max(0, base), 10, rounding) : 0;
  const whBase = taxMode === "INCLUSIVE" ? base - tax : base;
  const wh = withholding ? withholdingOf(whBase) : 0;
  const pay = base + (taxMode === "EXCLUSIVE" ? tax : 0) - wh + exp;
  return { work, adj, exp, tax, wh, pay };
}

function payDue(month: string, payDay: number) {
  const [y, m] = month.split("-").map(Number);
  const ym = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const last = Number(monthRange(ym)[1].slice(8, 10));
  return `${ym}-${String(Math.min(payDay, last)).padStart(2, "0")}`;
}

/** 1人分の明細を生成・再生成（下書き・確認中のみ置き換え） */
async function generateOne(tx: Tx, actor: Actor, driverId: string, month: string): Promise<{ status: "created" | "regenerated" | "locked" | "empty"; warnings: string[]; id?: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`statement:${driverId}:${month}`}))`);
  const s = await getSettings(tx);
  const rounding = s.taxRounding as Rounding;
  const [d] = await tx.select({ d: driver, name: appUser.name }).from(driver).innerJoin(appUser, eq(appUser.id, driver.userId)).where(eq(driver.userId, driverId)).limit(1);
  if (!d) throw notFound("ドライバーが見つかりません");
  const [cur] = await tx.select().from(statement).where(and(eq(statement.driverId, driverId), eq(statement.month, month), ne(statement.status, "SUPERSEDED"))).for("update");
  if (cur && (cur.status === "CONFIRMED" || cur.status === "PUBLISHED")) return { status: "locked", warnings: [], id: cur.id };
  if (cur) await releaseLinks(tx, cur.id);
  const { lines, warnings, reportIds } = await buildLines(tx, driverId, month, rounding);
  if (!lines.length && !cur) return { status: "empty", warnings };
  const t = totals(lines, d.d.taxMode, d.d.withholdingEnabled, rounding);
  const values = {
    workAmount: t.work,
    adjustmentAmount: t.adj,
    taxAmount: t.tax,
    withholdingAmount: t.wh,
    expenseAmount: t.exp,
    payAmount: t.pay,
    payDueDate: payDue(month, s.statementPayDay),
    snapshot: { taxMode: d.d.taxMode, withholdingEnabled: d.d.withholdingEnabled, withholdingNote: d.d.withholdingConfirmedNote ?? "", rounding, companyName: s.companyName, driverName: d.name, warnings },
    generatedAt: new Date(),
  };
  let id: string;
  if (cur) {
    await tx.delete(statementLine).where(eq(statementLine.statementId, cur.id));
    await tx.update(statement).set({ ...values, status: "DRAFT" }).where(eq(statement.id, cur.id));
    id = cur.id;
  } else {
    // 訂正済みの旧版がある場合は版番号を続ける
    const [prev] = await tx.select({ id: statement.id, version: statement.version }).from(statement).where(and(eq(statement.driverId, driverId), eq(statement.month, month))).orderBy(desc(statement.version)).limit(1);
    const [n] = await tx.insert(statement).values({ driverId, month, ...values, version: (prev?.version ?? 0) + 1, supersedesId: prev?.id ?? null }).returning({ id: statement.id });
    id = n.id;
  }
  if (lines.length) {
    const inserted = await tx.insert(statementLine).values(lines.map((l) => ({ ...l, statementId: id }))).returning({ id: statementLine.id, expenseId: statementLine.expenseId });
    for (const l of inserted) if (l.expenseId) await tx.update(expense).set({ statementLineId: l.id }).where(and(eq(expense.id, l.expenseId), isNull(expense.statementLineId)));
  }
  if (reportIds.length) await tx.update(dailyReport).set({ statementId: id }).where(inArray(dailyReport.id, reportIds));
  await writeAudit(tx, actor, { action: cur ? "statement.regenerate" : "statement.generate", entityType: "statement", entityId: id, divisionId: d.d.divisionId, summary: `${d.name} ${month} の稼働明細を${cur ? "再生成" : "作成"}（支払予定 ${t.pay}円）` });
  return { status: cur ? "regenerated" : "created", warnings, id };
}

/** 下書きの再生成前に、日報・経費との紐付けを外す */
async function releaseLinks(tx: Tx, statementId: string) {
  await tx.update(dailyReport).set({ statementId: null }).where(eq(dailyReport.statementId, statementId));
  await tx.execute(sql`update expense set statement_line_id = null where statement_line_id in (select id from statement_line where statement_id = ${statementId})`);
}

/** 事業部単位で一括生成（対象月に承認済み日報・調整・立替経費があるドライバー） */
export async function generateForDivision(db: DB, actor: Actor, raw: { month: string; divisionId: string }) {
  if (!can.manageAccounting(actor) && actor.role !== "MANAGER") throw forbidden();
  const month = parse(z.string().regex(MONTH_RE, "対象月を選んでください"), raw.month);
  if (!canAccessDivision(actor, raw.divisionId)) throw forbidden();
  const [from, to] = monthRange(month);
  const ids = await db.execute<{ id: string }>(sql`
    select d.user_id id from driver d where d.division_id = ${raw.divisionId} and (
      exists (select 1 from daily_report r where r.driver_id = d.user_id and r.status = 'APPROVED' and r.work_date between ${from} and ${to})
      or exists (select 1 from statement_adjustment a where a.driver_id = d.user_id and a.month = ${month} and a.status = 'APPROVED')
      or exists (select 1 from expense e where e.applicant_id = d.user_id and e.status = 'APPROVED' and e.settlement = 'STATEMENT' and e.statement_line_id is null and e.month <= ${month})
      or exists (select 1 from statement s where s.driver_id = d.user_id and s.month = ${month} and s.status in ('DRAFT','REVIEW')))`);
  const result = { created: 0, regenerated: 0, locked: 0, empty: 0, warnings: [] as string[] };
  for (const { id } of ids.rows) {
    const r = await db.transaction((tx) => generateOne(tx, actor, id, month));
    result[r.status]++;
    result.warnings.push(...r.warnings);
  }
  return result;
}

export async function regenerateStatement(db: DB, actor: Actor, statementId: string) {
  const [s] = await db.select().from(statement).where(eq(statement.id, statementId)).limit(1);
  if (!s) throw notFound();
  await assertStatementAccess(db, actor, s.driverId);
  const r = await db.transaction((tx) => generateOne(tx, actor, s.driverId, s.month));
  if (r.status === "locked") throw conflict("確定済みの明細は再生成できません。訂正版を作成してください");
  return r;
}

async function assertStatementAccess(db: Tx, actor: Actor, driverId: string) {
  if (actor.role === "DRIVER") {
    if (actor.userId !== driverId) throw notFound("稼働明細が見つかりません");
    return;
  }
  const [d] = await db.select({ divisionId: driver.divisionId }).from(driver).where(eq(driver.userId, driverId)).limit(1);
  // 複数事業部にまたがる明細は、ドライバーの所属事業部の責任者と経営者・経理が扱う
  if (!d || !canAccessDivision(actor, d.divisionId)) throw notFound("稼働明細が見つかりません");
}

/* ================================================================== */
/* 状態の変更                                                           */
/* ================================================================== */

export async function setStatementStatus(db: DB, actor: Actor, id: string, to: "REVIEW" | "CONFIRMED" | "PUBLISHED" | "DRAFT") {
  if (actor.role === "DRIVER") throw forbidden();
  if ((to === "CONFIRMED" || to === "PUBLISHED") && !can.manageAccounting(actor)) throw forbidden("確定・公開は経営者・経理のみ可能です");
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(statement).where(eq(statement.id, id)).for("update");
    if (!s) throw notFound();
    await assertStatementAccess(tx, actor, s.driverId);
    const allowed: Record<string, string[]> = { REVIEW: ["DRAFT"], DRAFT: ["REVIEW"], CONFIRMED: ["REVIEW", "DRAFT"], PUBLISHED: ["CONFIRMED"] };
    if (!allowed[to].includes(s.status)) throw conflict(`現在の状態（${s.status}）からは変更できません`);
    const patch: Partial<typeof statement.$inferInsert> = { status: to };
    if (to === "CONFIRMED") {
      patch.confirmedAt = new Date();
      patch.confirmedById = actor.userId;
      // 支払予定（訂正版は支払済みの旧版との差額）
      const paidBefore = await paidOnPreviousVersions(tx, s);
      const due = s.payAmount - paidBefore;
      const [u] = await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, s.driverId)).limit(1);
      if (due > 0) {
        await tx.insert(payable).values({ source: "STATEMENT", sourceId: s.id, divisionId: null, payeeName: u?.name ?? "", description: `稼働明細 ${s.month}${s.version > 1 ? `（訂正版 第${s.version}版）` : ""}`, amount: due, dueDate: s.payDueDate ?? `${s.month}-28` });
      }
      patch.snapshot = { ...(s.snapshot as object), paidOnPreviousVersions: paidBefore, payableAmount: Math.max(0, due), overpaid: due < 0 ? -due : 0 };
    }
    if (to === "PUBLISHED") patch.publishedAt = new Date();
    await tx.update(statement).set(patch).where(and(eq(statement.id, id), eq(statement.status, s.status)));
    await writeAudit(tx, actor, { action: `statement.${to.toLowerCase()}`, entityType: "statement", entityId: id, summary: `稼働明細 ${s.month}（第${s.version}版）を ${to} に変更（支払予定 ${s.payAmount}円）` });
  });
}

async function paidOnPreviousVersions(tx: Tx, s: typeof statement.$inferSelect) {
  const [{ paid }] = await tx
    .select({ paid: sql<number>`coalesce(sum(${payable.amount}), 0)::float8` })
    .from(payable)
    .innerJoin(statement, eq(statement.id, payable.sourceId))
    .where(and(eq(payable.source, "STATEMENT"), eq(payable.status, "PAID"), eq(statement.driverId, s.driverId), eq(statement.month, s.month), ne(statement.id, s.id)));
  return paid;
}

/**
 * 訂正版の作成: 確定・公開済みの明細を「訂正済み（旧版）」にし、同じ月の新しい版を下書きで作る。
 * 旧版の未払いの支払予定は取消し、支払済みの額は新しい版の確定時に差し引く
 */
export async function createCorrection(db: DB, actor: Actor, id: string, reason: string) {
  if (!can.manageAccounting(actor)) throw forbidden("訂正版の作成は経営者・経理のみ可能です");
  const why = parse(zText("訂正理由", 500), reason);
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(statement).where(eq(statement.id, id)).for("update");
    if (!s) throw notFound();
    if (s.status !== "CONFIRMED" && s.status !== "PUBLISHED") throw invalid("訂正版は確定・公開済みの明細から作成します（下書きは再生成してください）");
    await tx.update(payable).set({ status: "CANCELED" }).where(and(eq(payable.source, "STATEMENT"), eq(payable.sourceId, id), eq(payable.status, "SCHEDULED")));
    await tx.update(statement).set({ status: "SUPERSEDED" }).where(eq(statement.id, id));
    // 旧版に含めていた日報・経費を解放（旧版の行自体は変更しない）
    await tx.update(dailyReport).set({ statementId: null }).where(eq(dailyReport.statementId, id));
    await tx.execute(sql`update expense set statement_line_id = null where statement_line_id in (select id from statement_line where statement_id = ${id})`);
    await writeAudit(tx, actor, { action: "statement.correct", entityType: "statement", entityId: id, summary: `稼働明細 ${s.month}（第${s.version}版）の訂正版を作成: ${why}` });
    const r = await generateOne(tx, actor, s.driverId, s.month);
    if (r.id) await tx.update(statement).set({ correctionReason: why }).where(eq(statement.id, r.id));
    return r.id!;
  });
}

/* ================================================================== */
/* 閲覧（ドライバーは公開済みの自分の明細のみ）                            */
/* ================================================================== */

export async function listStatements(db: DB, actor: Actor, opts: { month?: string; divisionId?: string } = {}) {
  const scope = actor.role === "DRIVER" ? null : divisionScope(actor);
  return db
    .select({ s: statement, driverName: appUser.name, divisionName: division.name })
    .from(statement)
    .innerJoin(appUser, eq(appUser.id, statement.driverId))
    .innerJoin(driver, eq(driver.userId, statement.driverId))
    .innerJoin(division, eq(division.id, driver.divisionId))
    .where(
      and(
        actor.role === "DRIVER" ? and(eq(statement.driverId, actor.userId), eq(statement.status, "PUBLISHED")) : undefined,
        scope ? (scope.length ? inArray(driver.divisionId, scope) : sql`false`) : undefined,
        opts.month ? eq(statement.month, opts.month) : undefined,
        opts.divisionId ? eq(driver.divisionId, opts.divisionId) : undefined,
      ),
    )
    .orderBy(desc(statement.month), asc(appUser.name), desc(statement.version));
}

export async function getStatement(db: DB, actor: Actor, id: string) {
  const [s] = await db.select({ s: statement, driverName: appUser.name }).from(statement).innerJoin(appUser, eq(appUser.id, statement.driverId)).where(eq(statement.id, id)).limit(1);
  if (!s) throw notFound("稼働明細が見つかりません");
  await assertStatementAccess(db, actor, s.s.driverId);
  if (actor.role === "DRIVER" && s.s.status !== "PUBLISHED") throw notFound("稼働明細が見つかりません");
  const lines = await db
    .select({ l: statementLine, divisionName: division.name, projectCode: project.code })
    .from(statementLine)
    .innerJoin(division, eq(division.id, statementLine.divisionId))
    .leftJoin(project, eq(project.id, statementLine.projectId))
    .where(eq(statementLine.statementId, id))
    .orderBy(asc(statementLine.sortOrder));
  const byDivision = new Map<string, number>();
  for (const { l, divisionName } of lines) if (l.kind !== "EXPENSE") byDivision.set(divisionName, (byDivision.get(divisionName) ?? 0) + l.amount);
  const inquiries = await db.select().from(statementInquiry).where(eq(statementInquiry.statementId, id)).orderBy(desc(statementInquiry.createdAt));
  const [pay] = await db.select().from(payable).where(and(eq(payable.source, "STATEMENT"), eq(payable.sourceId, id), ne(payable.status, "CANCELED"))).limit(1);
  const versions = await db.select({ id: statement.id, version: statement.version, status: statement.status }).from(statement).where(and(eq(statement.driverId, s.s.driverId), eq(statement.month, s.s.month))).orderBy(asc(statement.version));
  return { ...s, lines, byDivision: [...byDivision.entries()], inquiries, payable: pay ?? null, versions: actor.role === "DRIVER" ? [] : versions };
}

export async function acknowledgeStatement(db: DB, actor: Actor, id: string) {
  if (actor.role !== "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [s] = await tx.update(statement).set({ acknowledgedAt: new Date() }).where(and(eq(statement.id, id), eq(statement.driverId, actor.userId), eq(statement.status, "PUBLISHED"), isNull(statement.acknowledgedAt))).returning();
    if (!s) throw conflict("確認済みか、確認できない明細です");
    await writeAudit(tx, actor, { action: "statement.acknowledge", entityType: "statement", entityId: id, summary: `稼働明細 ${s.month} を確認済みにした` });
  });
}

export async function askAboutStatement(db: DB, actor: Actor, id: string, body: string) {
  if (actor.role !== "DRIVER") throw forbidden();
  const text = parse(zText("問い合わせ内容", 1000), body);
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(statement).where(and(eq(statement.id, id), eq(statement.driverId, actor.userId), eq(statement.status, "PUBLISHED"))).limit(1);
    if (!s) throw notFound("稼働明細が見つかりません");
    await tx.insert(statementInquiry).values({ statementId: id, driverId: actor.userId, body: text });
    await writeAudit(tx, actor, { action: "statement.inquiry", entityType: "statement", entityId: id, summary: `稼働明細 ${s.month} について問い合わせ` });
  });
}

export async function replyInquiry(db: DB, actor: Actor, inquiryId: string, reply: string) {
  if (actor.role === "DRIVER") throw forbidden();
  const text = parse(zText("回答", 1000), reply);
  await db.transaction(async (tx) => {
    const [q] = await tx.select({ q: statementInquiry, driverId: statement.driverId }).from(statementInquiry).innerJoin(statement, eq(statement.id, statementInquiry.statementId)).where(eq(statementInquiry.id, inquiryId)).for("update", { of: statementInquiry });
    if (!q) throw notFound();
    await assertStatementAccess(tx, actor, q.driverId);
    await tx.update(statementInquiry).set({ reply: text, repliedById: actor.userId, repliedAt: new Date() }).where(eq(statementInquiry.id, inquiryId));
    await writeAudit(tx, actor, { action: "statement.reply", entityType: "statement", entityId: q.q.statementId, summary: "稼働明細の問い合わせに回答" });
  });
}
