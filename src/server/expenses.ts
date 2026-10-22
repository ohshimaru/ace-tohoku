/**
 * 経費（会社側の申請とドライバーの経費報告の両方）
 * 状態: 下書き → 申請中 → 承認 / 差戻し（修正して再申請）/ 却下（終了）/ 取消
 * - 承認済み経費は対象事業部の経費・予算に一度だけ反映（状態から集計）
 * - 支払: 別払い・会社直接払いは承認時に支払予定を1件作成（一意制約）。稼働明細で精算する経費は明細経由で支払う
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, budgetCommitment, division, driver, expense, expenseCategory, payable, project, storedFile } from "@/db/schema";
import { deleteObject, getObject, putObject, safeName, validateFile } from "@/adapters/storage";
import { type Actor, canAccessDivision, divisionScope, isCompanyWide } from "@/lib/access";
import { monthRange, todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { taxFromGross, type Rounding } from "@/lib/money";
import { writeAudit } from "./audit";
import { checkExpenseBudget, type BudgetCheck } from "./budget";
import { getSettings } from "./masters";
import { assertMonthOpen } from "./months";
import { likePattern, pageParams, parse, zDate, zText, zUuid, zYen } from "./validate";

export const EXPENSE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "下書き",
  SUBMITTED: "申請中",
  APPROVED: "承認",
  RETURNED: "差戻し",
  REJECTED: "却下",
  CANCELED: "取消",
};

const expenseInput = z.object({
  usedOn: zDate("利用日"),
  divisionId: z.preprocess((v) => (v === "" || v === "COMMON" ? undefined : v), z.string().uuid().optional()).optional(),
  projectId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  categoryId: zUuid("費目"),
  payee: zText("支払先", 200),
  purpose: zText("用途", 1000),
  amount: zYen("金額（税込）", { min: 1 }),
  taxRate: z.coerce.number().refine((n) => n === 10 || n === 8 || n === 0, "税区分を選んでください"),
  settlement: z.enum(["SEPARATE", "STATEMENT", "COMPANY_PAID"]).default("SEPARATE"),
  commitmentId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
});
export type ExpenseInput = z.input<typeof expenseInput>;

/** 閲覧できるか: 申請者本人 / 全社権限 / 担当事業部の責任者 */
function canView(actor: Actor, e: { applicantId: string; divisionId: string | null }) {
  if (e.applicantId === actor.userId) return true;
  if (actor.role === "DRIVER") return false;
  return canAccessDivision(actor, e.divisionId);
}

/** 承認・差戻し・却下できるか（本人は不可） */
export function canDecide(actor: Actor, e: { applicantId: string; divisionId: string | null }) {
  if (e.applicantId === actor.userId) return false;
  if (actor.role === "DRIVER") return false;
  return canAccessDivision(actor, e.divisionId);
}

export function visibleExpensesWhere(actor: Actor): SQL | undefined {
  if (actor.role === "DRIVER") return eq(expense.applicantId, actor.userId);
  const scope = divisionScope(actor);
  if (!scope) return undefined;
  return or(eq(expense.applicantId, actor.userId), scope.length ? inArray(expense.divisionId, scope) : sql`false`);
}

async function validateRefs(tx: Tx, actor: Actor, input: z.output<typeof expenseInput>) {
  const divisionId = input.divisionId ?? null;
  if (actor.role === "DRIVER") {
    const [d] = await tx.select().from(driver).where(eq(driver.userId, actor.userId)).limit(1);
    if (!d) throw forbidden("ドライバー情報が登録されていません");
    if (divisionId !== d.divisionId) throw invalid("所属事業部の経費として申請してください");
    if (input.settlement === "COMPANY_PAID") throw invalid("精算方法を選んでください");
  } else {
    if (divisionId === null && !isCompanyWide(actor)) throw forbidden("共通経費（全社）は経営者・経理のみ登録できます");
    if (divisionId && !canAccessDivision(actor, divisionId)) throw forbidden("担当外の事業部の経費は登録できません");
    if (input.settlement === "STATEMENT") throw invalid("稼働明細での精算はドライバーの経費だけで選べます");
  }
  if (input.projectId) {
    const [p] = await tx.select({ divisionId: project.divisionId, archivedAt: project.archivedAt }).from(project).where(eq(project.id, input.projectId)).limit(1);
    if (!p || p.archivedAt) throw notFound("案件が見つかりません");
    if (p.divisionId !== divisionId) throw invalid("案件と事業部が一致しません");
  }
  const [c] = await tx.select({ id: expenseCategory.id }).from(expenseCategory).where(and(eq(expenseCategory.id, input.categoryId), isNull(expenseCategory.archivedAt))).limit(1);
  if (!c) throw invalid("費目が見つかりません");
  if (input.commitmentId) {
    const [cm] = await tx.select().from(budgetCommitment).where(eq(budgetCommitment.id, input.commitmentId)).limit(1);
    if (!cm || cm.status !== "OPEN" || cm.divisionId !== divisionId) throw invalid("紐付ける発注が見つからないか、既に消化済みです");
  }
  if (input.usedOn > todayJst()) throw invalid("未来の日付の経費は登録できません");
  return divisionId;
}

async function rounding(tx: Tx): Promise<Rounding> {
  return (await getSettings(tx)).taxRounding as Rounding;
}

export async function createExpense(db: DB, actor: Actor, raw: ExpenseInput) {
  const input = parse(expenseInput, raw);
  return db.transaction(async (tx) => {
    const divisionId = await validateRefs(tx, actor, input);
    const month = input.usedOn.slice(0, 7);
    await assertMonthOpen(tx, month, "経費");
    const taxAmount = taxFromGross(input.amount, input.taxRate, await rounding(tx));
    const [e] = await tx
      .insert(expense)
      .values({ ...input, divisionId, projectId: input.projectId ?? null, commitmentId: input.commitmentId ?? null, month, taxAmount, applicantId: actor.userId })
      .returning({ id: expense.id });
    await writeAudit(tx, actor, { action: "expense.create", entityType: "expense", entityId: e.id, divisionId, summary: `経費の下書きを作成（${input.payee} ${input.amount}円）` });
    return e.id;
  });
}

async function lockOwnEditable(tx: Tx, actor: Actor, id: string) {
  const [e] = await tx.select().from(expense).where(eq(expense.id, id)).for("update");
  if (!e || e.applicantId !== actor.userId) throw notFound("経費が見つかりません");
  if (e.status !== "DRAFT" && e.status !== "RETURNED") throw conflict("下書きまたは差戻しの経費だけ編集できます");
  return e;
}

export async function updateExpense(db: DB, actor: Actor, id: string, raw: ExpenseInput) {
  const input = parse(expenseInput, raw);
  await db.transaction(async (tx) => {
    const before = await lockOwnEditable(tx, actor, id);
    const divisionId = await validateRefs(tx, actor, input);
    const month = input.usedOn.slice(0, 7);
    await assertMonthOpen(tx, before.month, "経費");
    await assertMonthOpen(tx, month, "経費");
    const taxAmount = taxFromGross(input.amount, input.taxRate, await rounding(tx));
    await tx.update(expense).set({ ...input, divisionId, projectId: input.projectId ?? null, commitmentId: input.commitmentId ?? null, month, taxAmount }).where(eq(expense.id, id));
    await writeAudit(tx, actor, { action: "expense.update", entityType: "expense", entityId: id, divisionId, summary: "経費を編集", changes: { before: { amount: before.amount, usedOn: before.usedOn, divisionId: before.divisionId }, after: { amount: input.amount, usedOn: input.usedOn, divisionId } } });
  });
}

/** 申請。予算超過時: 警告ルールは申請可、制限ルールは「例外申請」としてのみ申請可 */
export async function submitExpense(db: DB, actor: Actor, id: string, opts: { exceptionReason?: string } = {}): Promise<BudgetCheck> {
  return db.transaction(async (tx) => {
    const e = await lockOwnEditable(tx, actor, id);
    await assertMonthOpen(tx, e.month, "経費");
    const check = await checkExpenseBudget(tx, e);
    const reason = opts.exceptionReason?.trim();
    if (check.blocked && !reason) {
      throw invalid(`予算の申請制限を超えるため申請できません。${check.messages.join(" / ")}。必要な場合は「例外承認を求める」に理由を書いて申請してください`);
    }
    const [done] = await tx
      .update(expense)
      .set({ status: "SUBMITTED", submittedAt: new Date(), decisionNote: null, budgetExceptionNote: check.blocked ? reason : null })
      .where(and(eq(expense.id, id), inArray(expense.status, ["DRAFT", "RETURNED"])))
      .returning({ id: expense.id });
    if (!done) throw conflict("この経費は既に申請されています");
    await writeAudit(tx, actor, { action: "expense.submit", entityType: "expense", entityId: id, divisionId: e.divisionId, summary: `経費を申請（${e.payee} ${e.amount}円）${check.ok ? "" : `／予算超過: ${check.messages.join(" / ")}`}` });
    return check;
  });
}

async function lockForDecision(tx: Tx, actor: Actor, id: string) {
  const [e] = await tx.select().from(expense).where(eq(expense.id, id)).for("update");
  if (!e || !canView(actor, e)) throw notFound("経費が見つかりません");
  if (e.applicantId === actor.userId) throw forbidden("自分の申請は承認・差戻し・却下できません");
  if (!canDecide(actor, e)) throw forbidden("この経費を処理する権限がありません");
  if (e.status !== "SUBMITTED") throw conflict("この申請は既に処理されています");
  await assertMonthOpen(tx, e.month, "経費");
  return e;
}

function nextPayDate(usedOrToday: string, payDay: number) {
  const [y, m] = usedOrToday.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // 翌月1日
  const ym = next.toISOString().slice(0, 7);
  const [, last] = monthRange(ym);
  const lastDay = Number(last.slice(8, 10));
  return `${ym}-${String(Math.min(payDay, lastDay)).padStart(2, "0")}`;
}

export async function approveExpense(db: DB, actor: Actor, id: string): Promise<BudgetCheck> {
  return db.transaction(async (tx) => {
    const e = await lockForDecision(tx, actor, id);
    const check = await checkExpenseBudget(tx, e);
    // 申請制限を超える経費は、経営者・会社管理者の例外承認でのみ承認できる
    if (check.blocked && actor.role !== "OWNER") throw forbidden(`予算の申請制限を超えています（${check.messages.join(" / ")}）。経営者・会社管理者の例外承認が必要です`);
    const [done] = await tx
      .update(expense)
      .set({ status: "APPROVED", decidedById: actor.userId, decidedAt: new Date(), budgetExceptionById: check.blocked ? actor.userId : null })
      .where(and(eq(expense.id, id), eq(expense.status, "SUBMITTED")))
      .returning({ id: expense.id });
    if (!done) throw conflict("この申請は既に処理されています");
    if (e.commitmentId) {
      const [c] = await tx.update(budgetCommitment).set({ status: "CONSUMED" }).where(and(eq(budgetCommitment.id, e.commitmentId), eq(budgetCommitment.status, "OPEN"))).returning({ id: budgetCommitment.id });
      if (!c) throw conflict("紐付けた発注は既に消化済みか取消済みです");
    }
    if (e.settlement !== "STATEMENT") {
      const s = await getSettings(tx);
      const [applicant] = await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, e.applicantId)).limit(1);
      await tx.insert(payable).values({
        source: "EXPENSE",
        sourceId: e.id,
        divisionId: e.divisionId,
        payeeName: e.settlement === "SEPARATE" ? `${applicant?.name ?? ""}（立替精算）` : e.payee,
        description: `経費: ${e.purpose}`,
        amount: e.amount,
        dueDate: nextPayDate(todayJst(), s.statementPayDay),
      });
    }
    await writeAudit(tx, actor, { action: check.blocked ? "expense.approve_exception" : "expense.approve", entityType: "expense", entityId: id, divisionId: e.divisionId, summary: `経費を承認（${e.payee} ${e.amount}円）${check.blocked ? "【予算超過の例外承認】" : ""}` });
    return check;
  });
}

export async function returnExpense(db: DB, actor: Actor, id: string, reason: string) {
  const why = parse(zText("差戻し理由", 500), reason);
  await db.transaction(async (tx) => {
    const e = await lockForDecision(tx, actor, id);
    await tx.update(expense).set({ status: "RETURNED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: why }).where(and(eq(expense.id, id), eq(expense.status, "SUBMITTED")));
    await writeAudit(tx, actor, { action: "expense.return", entityType: "expense", entityId: id, divisionId: e.divisionId, summary: `経費を差戻し: ${why}` });
  });
}

export async function rejectExpense(db: DB, actor: Actor, id: string, reason: string) {
  const why = parse(zText("却下理由", 500), reason);
  await db.transaction(async (tx) => {
    const e = await lockForDecision(tx, actor, id);
    await tx.update(expense).set({ status: "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: why }).where(and(eq(expense.id, id), eq(expense.status, "SUBMITTED")));
    await writeAudit(tx, actor, { action: "expense.reject", entityType: "expense", entityId: id, divisionId: e.divisionId, summary: `経費を却下: ${why}` });
  });
}

/**
 * 取消（理由必須）
 * - 下書き・申請中・差戻し: 申請者本人
 * - 承認済み: 経営者・経理のみ。稼働明細に含めた経費・支払済みの経費は取消できない
 */
export async function cancelExpense(db: DB, actor: Actor, id: string, reason: string) {
  const why = parse(zText("取消理由", 500), reason);
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(expense).where(eq(expense.id, id)).for("update");
    if (!e || !canView(actor, e)) throw notFound("経費が見つかりません");
    if (e.status === "CANCELED" || e.status === "REJECTED") throw conflict("この経費は既に終了しています");
    await assertMonthOpen(tx, e.month, "経費");
    if (e.status === "APPROVED") {
      if (!isCompanyWide(actor)) throw forbidden("承認済みの経費の取消は経営者・経理のみ可能です");
      if (e.statementLineId) throw conflict("稼働明細に含めた経費は取消できません。明細の訂正版で対応してください");
      const [p] = await tx.select().from(payable).where(and(eq(payable.source, "EXPENSE"), eq(payable.sourceId, id), sql`${payable.status} <> 'CANCELED'`)).for("update");
      if (p?.status === "PAID") throw conflict("支払済みの経費は取消できません（返金の処理が必要です）");
      if (p) await tx.update(payable).set({ status: "CANCELED" }).where(eq(payable.id, p.id));
      if (e.commitmentId) await tx.update(budgetCommitment).set({ status: "OPEN" }).where(and(eq(budgetCommitment.id, e.commitmentId), eq(budgetCommitment.status, "CONSUMED")));
    } else if (e.applicantId !== actor.userId) {
      throw forbidden("未承認の経費は申請者本人が取消してください");
    }
    await tx.update(expense).set({ status: "CANCELED", canceledAt: new Date(), cancelReason: why }).where(and(eq(expense.id, id), eq(expense.status, e.status)));
    await writeAudit(tx, actor, { action: "expense.cancel", entityType: "expense", entityId: id, divisionId: e.divisionId, summary: `経費を取消（元の状態: ${EXPENSE_STATUS_LABEL[e.status]}）: ${why}` });
  });
}

/* ---------------- 閲覧 ---------------- */

export async function listExpenses(
  db: DB,
  actor: Actor,
  opts: { status?: string; divisionId?: string; projectId?: string; month?: string; q?: string; mine?: boolean; noReceipt?: boolean; page?: string } = {},
) {
  const { limit, offset, page } = pageParams(opts.page);
  const conds: (SQL | undefined)[] = [visibleExpensesWhere(actor)];
  if (opts.mine) conds.push(eq(expense.applicantId, actor.userId));
  if (opts.status) conds.push(sql`${expense.status} = ${opts.status}`);
  if (opts.divisionId === "COMMON") conds.push(isNull(expense.divisionId));
  else if (opts.divisionId) conds.push(eq(expense.divisionId, opts.divisionId));
  if (opts.projectId) conds.push(eq(expense.projectId, opts.projectId));
  if (opts.month) conds.push(eq(expense.month, opts.month));
  if (opts.q) conds.push(or(ilike(expense.payee, likePattern(opts.q)), ilike(expense.purpose, likePattern(opts.q))));
  if (opts.noReceipt) conds.push(inArray(expense.status, ["SUBMITTED", "APPROVED"]), sql`not exists (select 1 from stored_file f where f.owner_type = 'EXPENSE' and f.owner_id = ${expense.id})`);
  const where = and(...conds);
  const rows = await db
    .select({
      id: expense.id,
      usedOn: expense.usedOn,
      month: expense.month,
      amount: expense.amount,
      taxRate: expense.taxRate,
      payee: expense.payee,
      purpose: expense.purpose,
      status: expense.status,
      settlement: expense.settlement,
      divisionName: division.name,
      categoryName: expenseCategory.name,
      projectCode: project.code,
      applicantName: appUser.name,
      applicantId: expense.applicantId,
      divisionId: expense.divisionId,
      fileCount: sql<number>`(select count(*)::int from stored_file f where f.owner_type = 'EXPENSE' and f.owner_id = ${expense.id})`,
      payStatus: sql<string | null>`(select p.status from payable p where p.source = 'EXPENSE' and p.source_id = ${expense.id} and p.status <> 'CANCELED' limit 1)`,
      inStatement: sql<boolean>`${expense.statementLineId} is not null`,
    })
    .from(expense)
    .leftJoin(division, eq(division.id, expense.divisionId))
    .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
    .leftJoin(project, eq(project.id, expense.projectId))
    .innerJoin(appUser, eq(appUser.id, expense.applicantId))
    .where(where)
    .orderBy(desc(expense.usedOn), desc(expense.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(expense).where(where);
  return { rows: rows.map((r) => ({ ...r, canDecide: r.status === "SUBMITTED" && canDecide(actor, r) })), total, page, limit };
}

export async function getExpense(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ e: expense, divisionName: division.name, categoryName: expenseCategory.name, projectCode: project.code, projectName: project.name, applicantName: appUser.name })
    .from(expense)
    .leftJoin(division, eq(division.id, expense.divisionId))
    .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
    .leftJoin(project, eq(project.id, expense.projectId))
    .innerJoin(appUser, eq(appUser.id, expense.applicantId))
    .where(eq(expense.id, id))
    .limit(1);
  if (!row || !canView(actor, row.e)) throw notFound("経費が見つかりません");
  const files = await db.select({ id: storedFile.id, name: storedFile.originalName, size: storedFile.size, mimeType: storedFile.mimeType }).from(storedFile).where(and(eq(storedFile.ownerType, "EXPENSE"), eq(storedFile.ownerId, id))).orderBy(asc(storedFile.createdAt));
  const [pay] = await db.select().from(payable).where(and(eq(payable.source, "EXPENSE"), eq(payable.sourceId, id), sql`${payable.status} <> 'CANCELED'`)).limit(1);
  const budget = row.e.status === "SUBMITTED" || row.e.status === "DRAFT" || row.e.status === "RETURNED" ? await db.transaction((tx) => checkExpenseBudget(tx, row.e)) : null;
  return { ...row, files, payable: pay ?? null, budget, canDecide: row.e.status === "SUBMITTED" && canDecide(actor, row.e), isOwn: row.e.applicantId === actor.userId };
}

/** 承認待ちの件数・一覧（自分が処理できるもの） */
export async function listPendingForDecision(db: DB, actor: Actor) {
  if (actor.role === "DRIVER") return [];
  const scope = divisionScope(actor);
  const rows = await db
    .select({ id: expense.id, usedOn: expense.usedOn, amount: expense.amount, payee: expense.payee, applicantName: appUser.name, applicantId: expense.applicantId, divisionId: expense.divisionId, divisionName: division.name, submittedAt: expense.submittedAt, exceptionNote: expense.budgetExceptionNote })
    .from(expense)
    .innerJoin(appUser, eq(appUser.id, expense.applicantId))
    .leftJoin(division, eq(division.id, expense.divisionId))
    .where(and(eq(expense.status, "SUBMITTED"), sql`${expense.applicantId} <> ${actor.userId}`, scope ? (scope.length ? inArray(expense.divisionId, scope) : sql`false`) : undefined))
    .orderBy(asc(expense.submittedAt));
  return rows;
}

/* ---------------- 領収書 ---------------- */

export async function addExpenseFile(db: DB, actor: Actor, expenseId: string, file: { name: string; bytes: Uint8Array }) {
  const mime = validateFile(file.bytes);
  const key = await putObject("receipts", file.bytes, mime);
  try {
    return await db.transaction(async (tx) => {
      const e = await lockOwnEditable(tx, actor, expenseId);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(storedFile).where(and(eq(storedFile.ownerType, "EXPENSE"), eq(storedFile.ownerId, expenseId)));
      if (n >= 5) throw invalid("領収書は1件の経費につき5ファイルまでです");
      const [f] = await tx.insert(storedFile).values({ storageKey: key, originalName: safeName(file.name), mimeType: mime, size: file.bytes.length, ownerType: "EXPENSE", ownerId: expenseId, uploadedById: actor.userId }).returning({ id: storedFile.id });
      await writeAudit(tx, actor, { action: "expense.attach", entityType: "expense", entityId: expenseId, divisionId: e.divisionId, summary: `領収書を添付（${mime}, ${file.bytes.length} bytes）` });
      return f.id;
    });
  } catch (err) {
    await deleteObject(key);
    throw err;
  }
}

export async function removeExpenseFile(db: DB, actor: Actor, fileId: string) {
  const key = await db.transaction(async (tx) => {
    const [f] = await tx.select().from(storedFile).where(and(eq(storedFile.id, fileId), eq(storedFile.ownerType, "EXPENSE"))).limit(1);
    if (!f) throw notFound("ファイルが見つかりません");
    await lockOwnEditable(tx, actor, f.ownerId);
    await tx.delete(storedFile).where(eq(storedFile.id, fileId));
    return f.storageKey;
  });
  await deleteObject(key);
}

/** ファイル取得（参照元の閲覧権限を毎回確認） */
export async function readStoredFile(db: DB, actor: Actor, fileId: string) {
  const [f] = await db.select().from(storedFile).where(eq(storedFile.id, fileId)).limit(1);
  if (!f) throw notFound("ファイルが見つかりません");
  const { canReadOwner } = await import("./file-access");
  if (!(await canReadOwner(db, actor, f.ownerType, f.ownerId))) throw notFound("ファイルが見つかりません");
  return { bytes: await getObject(f.storageKey), mimeType: f.mimeType, name: f.originalName };
}

export { canView as canViewExpense, nextPayDate };
