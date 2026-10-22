/**
 * 予算（社内ルール上使える予算）。銀行残高に基づく資金余力とは別の指標。
 *
 * 利用可能額 = 予算上限 − 計上済み実績 − 未計上の予約額
 * - 実績: 承認済みの経費（税込の支出額）
 * - 予約: 申請中の経費（設定で含める/含めない）＋ 未消化の発注済み費用（設定で含める/含めない）
 * どちらも経費・発注の「現在の状態」から毎回計算するため、申請中→承認で予約から実績へ移り、二重に引かれない。
 * 差戻し・却下・取消で予約から外れる。発注は実際の経費を紐付けた時点で消化済みになり予約から外れる。
 *
 * ルールは「対象（事業部×費目×利用者）」ごとの枠。同じ対象に複数のルールがある場合は優先順位の高いもの1つを使う。
 * 経費は、自分が属するすべての枠に収まる必要がある（例: 事業部全体の枠と、広告費の枠）。
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { budgetAdjustment, budgetCommitment, budgetRequest, budgetRule, division, expense, expenseCategory, sale } from "@/db/schema";
import { type Actor, can, canAccessDivision, divisionScope } from "@/lib/access";
import { addMonths, fiscalYearOf, fiscalYearRange, monthRange, todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { applyBp } from "@/lib/money";
import { writeAudit } from "./audit";
import { countActiveDrivers, countDivisionManagers, getSettings } from "./masters";
import { parse, zDate, zMonth, zOptDate, zText, zUuid, zYen } from "./validate";

type Rule = typeof budgetRule.$inferSelect;

export type Envelope = {
  rule: Rule;
  scopeLabel: string;
  periodLabel: string;
  months: [string, string];
  cap: number;
  used: number;
  reserved: number;
  available: number;
  consumptionRate: number | null;
  forecast: number | null;
  basis: { label: string; amount: number; note?: string }[];
};

function scopeKey(r: Pick<Rule, "divisionId" | "categoryId" | "userId">) {
  return `${r.divisionId ?? "*"}|${r.categoryId ?? "*"}|${r.userId ?? "*"}`;
}

/** 対象月に有効なルールから、対象ごとに優先順位の最も高いものを選ぶ */
export function pickRules(rules: Rule[], month: string): Rule[] {
  const [from, to] = monthRange(month);
  const active = rules.filter((r) => !r.archivedAt && r.effectiveFrom <= to && (!r.effectiveTo || r.effectiveTo >= from));
  const best = new Map<string, Rule>();
  for (const r of active) {
    const k = scopeKey(r);
    const cur = best.get(k);
    if (!cur || r.priority > cur.priority || (r.priority === cur.priority && r.effectiveFrom > cur.effectiveFrom)) best.set(k, r);
  }
  return [...best.values()];
}

function periodMonths(r: Rule, month: string, fyStart: number): [string, string] {
  if (r.period === "YEAR") return fiscalYearRange(fiscalYearOf(month, fyStart), fyStart);
  return [month, month];
}

/** 枠に含まれる経費・発注の条件 */
function expenseScope(r: Rule) {
  return and(
    r.divisionId ? eq(expense.divisionId, r.divisionId) : isNull(expense.divisionId),
    r.categoryId ? eq(expense.categoryId, r.categoryId) : undefined,
    r.userId ? eq(expense.applicantId, r.userId) : undefined,
  );
}

async function sumExpenses(db: Tx, r: Rule, months: [string, string], statuses: ("APPROVED" | "SUBMITTED")[], excludeId?: string) {
  const [{ s }] = await db
    .select({ s: sql<number>`coalesce(sum(${expense.amount}), 0)::float8` })
    .from(expense)
    .where(and(expenseScope(r), inArray(expense.status, statuses), gte(expense.month, months[0]), lte(expense.month, months[1]), excludeId ? sql`${expense.id} <> ${excludeId}` : undefined));
  return s;
}

async function sumCommitments(db: Tx, r: Rule, months: [string, string]) {
  if (r.userId || !r.divisionId) return 0; // 発注は事業部単位で管理
  const [{ s }] = await db
    .select({ s: sql<number>`coalesce(sum(${budgetCommitment.amount}), 0)::float8` })
    .from(budgetCommitment)
    .where(and(eq(budgetCommitment.divisionId, r.divisionId), r.categoryId ? eq(budgetCommitment.categoryId, r.categoryId) : undefined, eq(budgetCommitment.status, "OPEN"), gte(budgetCommitment.month, months[0]), lte(budgetCommitment.month, months[1])));
  return s;
}

async function salesAndProfit(db: Tx, divisionId: string, months: [string, string]) {
  const [{ sales }] = await db
    .select({ sales: sql<number>`coalesce(sum(${sale.amountExTax}), 0)::float8` })
    .from(sale)
    .where(and(eq(sale.divisionId, divisionId), sql`${sale.canceledAt} is null`, gte(sale.month, months[0]), lte(sale.month, months[1])));
  // 利益は事業部の直接経費（承認済み・税抜）を引いた値（配賦前）
  const [{ cost }] = await db
    .select({ cost: sql<number>`coalesce(sum(${expense.amount} - ${expense.taxAmount}), 0)::float8` })
    .from(expense)
    .where(and(eq(expense.divisionId, divisionId), eq(expense.status, "APPROVED"), gte(expense.month, months[0]), lte(expense.month, months[1])));
  return { sales, profit: sales - cost };
}

async function computeEnvelope(db: Tx, r: Rule, month: string, opts: { excludeExpenseId?: string; depth?: number } = {}): Promise<Envelope> {
  const s = await getSettings(db);
  const months = periodMonths(r, month, s.fiscalYearStartMonth);
  const basis: Envelope["basis"] = [];
  let cap = 0;
  if (r.fixedAmount) {
    cap += r.fixedAmount;
    basis.push({ label: "固定上限", amount: r.fixedAmount });
  }
  if (r.perHeadAmount && r.divisionId) {
    const n = r.headcountBasis === "DIVISION_USERS" ? await countDivisionManagers(db, r.divisionId) : await countActiveDrivers(db, r.divisionId);
    cap += r.perHeadAmount * n;
    basis.push({ label: `人数連動（${n}人 × ${r.perHeadAmount.toLocaleString()}円）`, amount: r.perHeadAmount * n, note: r.headcountBasis === "DIVISION_USERS" ? "担当者数" : "稼働中のドライバー数（現在）" });
  }
  if (r.base !== "NONE" && r.baseRatioBp && r.divisionId) {
    const len = r.period === "YEAR" ? 12 : 1;
    const win: [string, string] = r.baseWindow === "PREV" ? [addMonths(months[0], -len), addMonths(months[1], -len)] : months;
    const { sales, profit } = await salesAndProfit(db, r.divisionId, win);
    const base = Math.max(0, r.base === "SALES" ? sales : profit);
    const v = applyBp(base, r.baseRatioBp);
    cap += v;
    basis.push({ label: `${r.base === "SALES" ? "売上" : "利益"}連動（${win[0] === win[1] ? win[0] : `${win[0]}〜${win[1]}`}の${r.base === "SALES" ? "売上" : "利益"} ${base.toLocaleString()}円 × ${r.baseRatioBp / 100}%）`, amount: v });
  }
  // 繰越（月間ルールのみ、同じ会計年度内の前月の残額）
  const depth = opts.depth ?? 0;
  if (r.carryOver && r.period === "MONTH" && depth < 11) {
    const prev = addMonths(month, -1);
    if (fiscalYearOf(prev, s.fiscalYearStartMonth) === fiscalYearOf(month, s.fiscalYearStartMonth) && r.effectiveFrom <= monthRange(prev)[1]) {
      const pe = await computeEnvelope(db, r, prev, { depth: depth + 1 });
      const carry = Math.max(0, pe.cap - pe.used - pe.reserved);
      if (carry > 0) {
        cap += carry;
        basis.push({ label: `繰越（${prev}の残額）`, amount: carry });
      }
    }
  }
  if (r.divisionId && !r.userId) {
    const [{ adj }] = await db
      .select({ adj: sql<number>`coalesce(sum(${budgetAdjustment.amount}), 0)::float8` })
      .from(budgetAdjustment)
      .where(and(eq(budgetAdjustment.divisionId, r.divisionId), r.categoryId ? eq(budgetAdjustment.categoryId, r.categoryId) : isNull(budgetAdjustment.categoryId), gte(budgetAdjustment.month, months[0]), lte(budgetAdjustment.month, months[1])));
    if (adj) {
      cap += adj;
      basis.push({ label: "承認済みの予算追加", amount: adj });
    }
  }
  const used = await sumExpenses(db, r, months, ["APPROVED"], opts.excludeExpenseId);
  const reservedExp = s.reserveSubmittedExpenses ? await sumExpenses(db, r, months, ["SUBMITTED"], opts.excludeExpenseId) : 0;
  const reservedCom = s.reserveCommitments ? await sumCommitments(db, r, months) : 0;
  const reserved = reservedExp + reservedCom;
  // 月末見込み（月間ルール・当月のみ）: 経過日数に対する実績のペースで延長
  let forecast: number | null = null;
  const today = todayJst();
  if (r.period === "MONTH" && today.slice(0, 7) === month) {
    const [, last] = monthRange(month);
    const elapsed = Number(today.slice(8, 10));
    const days = Number(last.slice(8, 10));
    forecast = Math.round(((used + reservedExp) / elapsed) * days) + reservedCom;
  }
  return {
    rule: r,
    scopeLabel: "",
    periodLabel: months[0] === months[1] ? months[0] : `${months[0]}〜${months[1]}（年度）`,
    months,
    cap,
    used,
    reserved,
    available: cap - used - reserved,
    consumptionRate: cap > 0 ? (used + reserved) / cap : null,
    forecast,
    basis: [...basis, ...(reservedExp ? [{ label: "予約: 申請中の経費", amount: -reservedExp }] : []), ...(reservedCom ? [{ label: "予約: 発注済み費用", amount: -reservedCom }] : []), { label: "実績: 承認済みの経費", amount: -used }],
  };
}

async function labelOf(db: Tx, r: Rule) {
  const parts: string[] = [];
  if (r.divisionId) {
    const [d] = await db.select({ name: division.name }).from(division).where(eq(division.id, r.divisionId)).limit(1);
    parts.push(d?.name ?? "（不明な事業部）");
  } else parts.push("共通経費（全社）");
  if (r.categoryId) {
    const [c] = await db.select({ name: expenseCategory.name }).from(expenseCategory).where(eq(expenseCategory.id, r.categoryId)).limit(1);
    parts.push(c?.name ?? "");
  } else parts.push("全費目");
  if (r.userId) parts.push("個人枠");
  return parts.join(" / ");
}

/** 経費が属する枠（予算チェック用） */
export async function envelopesForExpense(db: Tx, e: { id?: string; divisionId: string | null; categoryId: string; applicantId: string; month: string }) {
  const rules = await db
    .select()
    .from(budgetRule)
    .where(
      and(
        e.divisionId ? eq(budgetRule.divisionId, e.divisionId) : isNull(budgetRule.divisionId),
        or(isNull(budgetRule.categoryId), eq(budgetRule.categoryId, e.categoryId)),
        or(isNull(budgetRule.userId), eq(budgetRule.userId, e.applicantId)),
      ),
    );
  const picked = pickRules(rules, e.month);
  const out: Envelope[] = [];
  for (const r of picked) {
    const env = await computeEnvelope(db, r, e.month, { excludeExpenseId: e.id });
    env.scopeLabel = await labelOf(db, r);
    out.push(env);
  }
  return out;
}

export type BudgetCheck = { ok: boolean; blocked: boolean; messages: string[] };

/** 経費の金額が予算に収まるか（この経費自身は除いて計算） */
export async function checkExpenseBudget(db: Tx, e: { id?: string; divisionId: string | null; categoryId: string; applicantId: string; month: string; amount: number }): Promise<BudgetCheck> {
  // 同じ事業部の予算判定を直列化（同時申請ですり抜けないように）
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`budget:${e.divisionId ?? "common"}`}))`);
  const envs = await envelopesForExpense(db, e);
  const messages: string[] = [];
  let blocked = false;
  for (const env of envs) {
    if (e.amount > env.available) {
      messages.push(`予算「${env.scopeLabel}」（${env.periodLabel}）を ${(e.amount - env.available).toLocaleString()}円 超えます（利用可能額 ${env.available.toLocaleString()}円）`);
      if (env.rule.overAction === "BLOCK") blocked = true;
    }
  }
  return { ok: messages.length === 0, blocked, messages };
}

/** 予算の一覧（事業部責任者は担当事業部のみ） */
export async function listBudgetStatus(db: DB, actor: Actor, month: string) {
  const ym = parse(zMonth("対象月"), month);
  if (actor.role === "DRIVER") throw forbidden();
  const scope = divisionScope(actor);
  const rules = await db
    .select()
    .from(budgetRule)
    .where(scope ? (scope.length ? inArray(budgetRule.divisionId, scope) : sql`false`) : undefined);
  const picked = pickRules(rules, ym);
  const out: Envelope[] = [];
  for (const r of picked) {
    const env = await computeEnvelope(db, r, ym);
    env.scopeLabel = await labelOf(db, r);
    out.push(env);
  }
  return out.sort((a, b) => a.scopeLabel.localeCompare(b.scopeLabel, "ja"));
}

/* ---------------- ルールの管理 ---------------- */

const ruleInput = z.object({
  name: zText("ルール名", 100),
  divisionId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  userId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  categoryId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  period: z.enum(["MONTH", "YEAR"]),
  fixedAmount: zYen("固定上限"),
  perHeadAmount: zYen("1人あたり額"),
  headcountBasis: z.enum(["DIVISION_DRIVERS", "DIVISION_USERS"]),
  base: z.enum(["NONE", "SALES", "PROFIT"]),
  basePercent: z.coerce.number().min(0, "割合は0〜100%").max(100, "割合は0〜100%").default(0),
  baseWindow: z.enum(["PREV", "SAME"]),
  carryOver: z.coerce.boolean(),
  effectiveFrom: zDate("適用開始日"),
  effectiveTo: zOptDate("適用終了日"),
  overAction: z.enum(["WARN", "BLOCK"]),
  priority: z.coerce.number().int().min(-100).max(100).default(0),
});
export type RuleInput = z.input<typeof ruleInput>;

export async function listRules(db: DB, actor: Actor) {
  if (actor.role === "DRIVER") throw forbidden();
  const scope = divisionScope(actor);
  return db
    .select({ rule: budgetRule, divisionName: division.name, categoryName: expenseCategory.name })
    .from(budgetRule)
    .leftJoin(division, eq(division.id, budgetRule.divisionId))
    .leftJoin(expenseCategory, eq(expenseCategory.id, budgetRule.categoryId))
    .where(and(isNull(budgetRule.archivedAt), scope ? (scope.length ? inArray(budgetRule.divisionId, scope) : sql`false`) : undefined))
    .orderBy(division.sortOrder, desc(budgetRule.priority));
}

export async function saveRule(db: DB, actor: Actor, id: string | null, raw: RuleInput) {
  if (!can.editBudgetRules(actor)) throw forbidden("予算ルールの設定は経営者・会社管理者のみ可能です");
  const input = parse(ruleInput, raw);
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw invalid("適用終了日は開始日以降にしてください");
  if (input.carryOver && input.period !== "MONTH") throw invalid("繰越は月間ルールでのみ使えます");
  if ((input.perHeadAmount || input.base !== "NONE") && !input.divisionId) throw invalid("人数連動・売上/利益連動は事業部を指定したルールでのみ使えます");
  const { basePercent, ...rest } = input;
  const values = { ...rest, baseRatioBp: Math.round(basePercent * 100), divisionId: input.divisionId ?? null, userId: input.userId ?? null, categoryId: input.categoryId ?? null, effectiveTo: input.effectiveTo ?? null };
  return db.transaction(async (tx) => {
    if (id) {
      const [b] = await tx.select().from(budgetRule).where(eq(budgetRule.id, id)).for("update");
      if (!b) throw notFound("ルールが見つかりません");
      await tx.update(budgetRule).set(values).where(eq(budgetRule.id, id));
      await writeAudit(tx, actor, { action: "budget_rule.update", entityType: "budget_rule", entityId: id, divisionId: values.divisionId, summary: `予算ルール「${input.name}」を更新`, changes: { before: b, after: values } });
      return id;
    }
    const [r] = await tx.insert(budgetRule).values(values).returning({ id: budgetRule.id });
    await writeAudit(tx, actor, { action: "budget_rule.create", entityType: "budget_rule", entityId: r.id, divisionId: values.divisionId, summary: `予算ルール「${input.name}」を作成`, changes: values });
    return r.id;
  });
}

export async function archiveRule(db: DB, actor: Actor, id: string) {
  if (!can.editBudgetRules(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [r] = await tx.update(budgetRule).set({ archivedAt: new Date() }).where(eq(budgetRule.id, id)).returning();
    if (!r) throw notFound();
    await writeAudit(tx, actor, { action: "budget_rule.archive", entityType: "budget_rule", entityId: id, divisionId: r.divisionId, summary: `予算ルール「${r.name}」を終了` });
  });
}

/* ---------------- 発注済み費用（予約） ---------------- */

const commitmentInput = z.object({
  divisionId: zUuid("事業部"),
  categoryId: zUuid("費目"),
  projectId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  description: zText("内容", 200),
  amount: zYen("金額（税込）", { min: 1 }),
  orderedOn: zDate("発注日"),
});

export async function addCommitment(db: DB, actor: Actor, raw: z.input<typeof commitmentInput>) {
  if (actor.role === "DRIVER") throw forbidden();
  const input = parse(commitmentInput, raw);
  if (!canAccessDivision(actor, input.divisionId)) throw forbidden("担当外の事業部です");
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(budgetCommitment).values({ ...input, projectId: input.projectId ?? null, month: input.orderedOn.slice(0, 7), createdById: actor.userId }).returning({ id: budgetCommitment.id });
    await writeAudit(tx, actor, { action: "commitment.create", entityType: "budget_commitment", entityId: c.id, divisionId: input.divisionId, summary: `発注済み費用「${input.description}」${input.amount}円を登録` });
    return c.id;
  });
}

export async function cancelCommitment(db: DB, actor: Actor, id: string) {
  if (actor.role === "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(budgetCommitment).where(eq(budgetCommitment.id, id)).for("update");
    if (!c || !canAccessDivision(actor, c.divisionId)) throw notFound("発注が見つかりません");
    if (c.status !== "OPEN") throw conflict("この発注は既に消化済みか取消済みです");
    await tx.update(budgetCommitment).set({ status: "CANCELED" }).where(eq(budgetCommitment.id, id));
    await writeAudit(tx, actor, { action: "commitment.cancel", entityType: "budget_commitment", entityId: id, divisionId: c.divisionId, summary: `発注済み費用「${c.description}」を取消（予約額から外す）` });
  });
}

export async function listCommitments(db: DB, actor: Actor) {
  const scope = divisionScope(actor);
  return db
    .select({ c: budgetCommitment, divisionName: division.name, categoryName: expenseCategory.name })
    .from(budgetCommitment)
    .innerJoin(division, eq(division.id, budgetCommitment.divisionId))
    .innerJoin(expenseCategory, eq(expenseCategory.id, budgetCommitment.categoryId))
    .where(and(eq(budgetCommitment.status, "OPEN"), scope ? (scope.length ? inArray(budgetCommitment.divisionId, scope) : sql`false`) : undefined))
    .orderBy(desc(budgetCommitment.orderedOn));
}

/* ---------------- 予算追加申請 ---------------- */

const requestInput = z.object({
  divisionId: zUuid("事業部"),
  categoryId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  month: zMonth("対象月"),
  amount: zYen("追加額", { min: 1 }),
  reason: zText("理由", 1000),
});

export async function requestBudget(db: DB, actor: Actor, raw: z.input<typeof requestInput>) {
  if (actor.role === "DRIVER") throw forbidden();
  const input = parse(requestInput, raw);
  if (!canAccessDivision(actor, input.divisionId)) throw forbidden("担当外の事業部です");
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(budgetRequest).values({ ...input, categoryId: input.categoryId ?? null, requestedById: actor.userId }).returning({ id: budgetRequest.id });
    await writeAudit(tx, actor, { action: "budget_request.create", entityType: "budget_request", entityId: r.id, divisionId: input.divisionId, summary: `予算追加を申請（${input.month} ${input.amount}円）` });
    return r.id;
  });
}

export async function decideBudgetRequest(db: DB, actor: Actor, id: string, approve: boolean, note: string) {
  if (!can.editBudgetRules(actor)) throw forbidden("予算追加の承認は経営者・会社管理者のみ可能です");
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(budgetRequest).where(eq(budgetRequest.id, id)).for("update");
    if (!r) throw notFound("申請が見つかりません");
    if (r.requestedById === actor.userId) throw forbidden("自分の申請は承認できません");
    if (r.status !== "PENDING") throw conflict("この申請は既に処理されています");
    await tx.update(budgetRequest).set({ status: approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: note || null }).where(and(eq(budgetRequest.id, id), eq(budgetRequest.status, "PENDING")));
    if (approve) {
      await tx.insert(budgetAdjustment).values({ divisionId: r.divisionId, categoryId: r.categoryId, month: r.month, amount: r.amount, requestId: r.id, reason: r.reason, createdById: actor.userId });
    }
    await writeAudit(tx, actor, { action: approve ? "budget_request.approve" : "budget_request.reject", entityType: "budget_request", entityId: id, divisionId: r.divisionId, summary: `予算追加申請を${approve ? "承認" : "却下"}（${r.month} ${r.amount}円）` });
  });
}

export async function listBudgetRequests(db: DB, actor: Actor) {
  const scope = divisionScope(actor);
  return db
    .select({ r: budgetRequest, divisionName: division.name })
    .from(budgetRequest)
    .innerJoin(division, eq(division.id, budgetRequest.divisionId))
    .where(scope ? (scope.length ? inArray(budgetRequest.divisionId, scope) : sql`false`) : undefined)
    .orderBy(desc(budgetRequest.createdAt))
    .limit(100);
}
