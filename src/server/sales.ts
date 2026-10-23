/** 売上（計上）と入金（別管理）、支払予定 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { division, partner, payable, project, receipt, sale } from "@/db/schema";
import { type Actor, canAccessDivision, divisionScope, isCompanyWide, isStaff } from "@/lib/access";
import { todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { taxFromNet, type Rounding } from "@/lib/money";
import { diff, writeAudit } from "./audit";
import { getSettings } from "./masters";
import { assertMonthOpen } from "./months";
import { likePattern, pageParams, parse, zDate, zOptDate, zText, zUuid, zYen } from "./validate";

export function visibleSalesWhere(actor: Actor): SQL | undefined {
  const scope = divisionScope(actor);
  if (!scope) return undefined;
  return scope.length ? inArray(sale.divisionId, scope) : sql`false`;
}

const saleInput = z.object({
  recognizedOn: zDate("計上日"),
  divisionId: zUuid("事業部"),
  customerId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  projectId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  description: zText("内容", 200),
  amountExTax: zYen("売上金額（税抜）", { min: 1 }),
  taxRate: z.coerce.number().refine((n) => n === 10 || n === 8 || n === 0, "税区分を選んでください"),
  billingStatus: z.enum(["UNBILLED", "BILLED", "NOT_REQUIRED"]).default("UNBILLED"),
  expectedReceiptDate: zOptDate("入金予定日"),
});
export type SaleInput = z.input<typeof saleInput>;

async function validateSaleRefs(tx: Tx, actor: Actor, input: z.output<typeof saleInput>) {
  if (!isStaff(actor)) throw forbidden();
  if (!canAccessDivision(actor, input.divisionId)) throw forbidden("担当外の事業部の売上は登録できません");
  let customerId = input.customerId ?? null;
  if (input.projectId) {
    const [p] = await tx.select().from(project).where(eq(project.id, input.projectId)).limit(1);
    if (!p) throw notFound("案件が見つかりません");
    if (p.divisionId !== input.divisionId) throw invalid("案件と事業部が一致しません");
    if (customerId && p.customerId && p.customerId !== customerId) throw invalid("案件と顧客が一致しません");
    customerId = customerId ?? p.customerId;
  }
  if (customerId) {
    const [c] = await tx.select({ isCustomer: partner.isCustomer }).from(partner).where(eq(partner.id, customerId)).limit(1);
    if (!c?.isCustomer) throw invalid("顧客を選んでください");
  }
  return customerId;
}

export async function createSale(db: DB, actor: Actor, raw: SaleInput, ext?: { source: string; id: string }) {
  const input = parse(saleInput, raw);
  return db.transaction(async (tx) => {
    const customerId = await validateSaleRefs(tx, actor, input);
    const month = input.recognizedOn.slice(0, 7);
    await assertMonthOpen(tx, month, "売上");
    const s = await getSettings(tx);
    const taxAmount = taxFromNet(input.amountExTax, input.taxRate, s.taxRounding as Rounding);
    try {
      const [r] = await tx
        .insert(sale)
        .values({ ...input, customerId, projectId: input.projectId ?? null, expectedReceiptDate: input.expectedReceiptDate ?? null, month, taxAmount, createdById: actor.userId, externalSource: ext?.source ?? null, externalId: ext?.id ?? null })
        .returning({ id: sale.id });
      await writeAudit(tx, actor, { action: "sale.create", entityType: "sale", entityId: r.id, divisionId: input.divisionId, summary: `売上を計上（${input.description} ${input.amountExTax}円・税抜）` });
      return r.id;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("同じ外部IDの売上が既に登録されています");
      throw e;
    }
  });
}

export async function updateSale(db: DB, actor: Actor, id: string, raw: SaleInput) {
  const input = parse(saleInput, raw);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(sale).where(and(eq(sale.id, id), visibleSalesWhere(actor))).for("update");
    if (!before) throw notFound("売上が見つかりません");
    if (before.canceledAt) throw conflict("取消済みの売上は編集できません");
    if (before.externalSource) throw invalid("外部から取り込んだ売上は、取込元（Clean Up）で修正して再取込してください");
    const customerId = await validateSaleRefs(tx, actor, input);
    const month = input.recognizedOn.slice(0, 7);
    await assertMonthOpen(tx, before.month, "売上");
    await assertMonthOpen(tx, month, "売上");
    const s = await getSettings(tx);
    const values = { ...input, customerId, projectId: input.projectId ?? null, expectedReceiptDate: input.expectedReceiptDate ?? null, month, taxAmount: taxFromNet(input.amountExTax, input.taxRate, s.taxRounding as Rounding) };
    const paid = await receivedTotal(tx, id);
    if (values.amountExTax + values.taxAmount < paid) throw invalid("入金済み額より少ない金額にはできません");
    await tx.update(sale).set(values).where(eq(sale.id, id));
    await writeAudit(tx, actor, { action: "sale.update", entityType: "sale", entityId: id, divisionId: input.divisionId, summary: `売上を更新（${input.description}）`, changes: diff(before as unknown as Record<string, unknown>, values) });
  });
}

export async function cancelSale(db: DB, actor: Actor, id: string, reason: string) {
  const why = parse(zText("取消理由", 500), reason);
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sale).where(and(eq(sale.id, id), visibleSalesWhere(actor))).for("update");
    if (!s) throw notFound("売上が見つかりません");
    if (s.canceledAt) throw conflict("既に取消済みです");
    await assertMonthOpen(tx, s.month, "売上");
    if ((await receivedTotal(tx, id)) > 0) throw conflict("入金がある売上は取消できません。先に入金を取消してください");
    await tx.update(sale).set({ canceledAt: new Date(), cancelReason: why }).where(eq(sale.id, id));
    await writeAudit(tx, actor, { action: "sale.cancel", entityType: "sale", entityId: id, divisionId: s.divisionId, summary: `売上を取消: ${why}` });
  });
}

async function receivedTotal(tx: Tx, saleId: string) {
  const [{ s }] = await tx.select({ s: sql<number>`coalesce(sum(${receipt.amount}), 0)::float8` }).from(receipt).where(and(eq(receipt.saleId, saleId), isNull(receipt.canceledAt)));
  return s;
}

const receivedExpr = sql<number>`coalesce((select sum(r.amount) from receipt r where r.sale_id = ${sale.id} and r.canceled_at is null), 0)::float8`;

export async function listSales(db: DB, actor: Actor, opts: { month?: string; from?: string; to?: string; divisionId?: string; projectId?: string; customerId?: string; status?: string; q?: string; page?: string } = {}) {
  if (!isStaff(actor)) throw forbidden();
  const { limit, offset, page } = pageParams(opts.page);
  const conds: (SQL | undefined)[] = [visibleSalesWhere(actor)];
  if (opts.month) conds.push(eq(sale.month, opts.month));
  if (opts.from) conds.push(gte(sale.month, opts.from));
  if (opts.to) conds.push(lte(sale.month, opts.to));
  if (opts.divisionId) conds.push(eq(sale.divisionId, opts.divisionId));
  if (opts.projectId) conds.push(eq(sale.projectId, opts.projectId));
  if (opts.customerId) conds.push(eq(sale.customerId, opts.customerId));
  if (opts.q) conds.push(or(ilike(sale.description, likePattern(opts.q)), ilike(partner.name, likePattern(opts.q))));
  if (opts.status === "canceled") conds.push(sql`${sale.canceledAt} is not null`);
  else conds.push(isNull(sale.canceledAt));
  if (opts.status === "unpaid") conds.push(sql`${sale.amountExTax} + ${sale.taxAmount} > ${receivedExpr}`);
  if (opts.status === "unbilled") conds.push(eq(sale.billingStatus, "UNBILLED"));
  const where = and(...conds);
  const rows = await db
    .select({
      id: sale.id,
      recognizedOn: sale.recognizedOn,
      month: sale.month,
      description: sale.description,
      amountExTax: sale.amountExTax,
      taxAmount: sale.taxAmount,
      taxRate: sale.taxRate,
      billingStatus: sale.billingStatus,
      expectedReceiptDate: sale.expectedReceiptDate,
      received: receivedExpr,
      canceledAt: sale.canceledAt,
      divisionName: division.name,
      customerName: partner.name,
      projectCode: project.code,
      externalSource: sale.externalSource,
      externalId: sale.externalId,
    })
    .from(sale)
    .innerJoin(division, eq(division.id, sale.divisionId))
    .leftJoin(partner, eq(partner.id, sale.customerId))
    .leftJoin(project, eq(project.id, sale.projectId))
    .where(where)
    .orderBy(desc(sale.recognizedOn), desc(sale.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ total, sum }] = await db
    .select({ total: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${sale.amountExTax}), 0)::float8` })
    .from(sale)
    .leftJoin(partner, eq(partner.id, sale.customerId))
    .where(where);
  return { rows: rows.map((r) => ({ ...r, gross: r.amountExTax + r.taxAmount, outstanding: r.amountExTax + r.taxAmount - r.received })), total, sum, page, limit };
}

export async function getSale(db: DB, actor: Actor, id: string) {
  if (!isStaff(actor)) throw forbidden();
  const [row] = await db
    .select({ s: sale, divisionName: division.name, customerName: partner.name, projectCode: project.code, projectName: project.name })
    .from(sale)
    .innerJoin(division, eq(division.id, sale.divisionId))
    .leftJoin(partner, eq(partner.id, sale.customerId))
    .leftJoin(project, eq(project.id, sale.projectId))
    .where(and(eq(sale.id, id), visibleSalesWhere(actor)))
    .limit(1);
  if (!row) throw notFound("売上が見つかりません");
  const receipts = await db.select().from(receipt).where(eq(receipt.saleId, id)).orderBy(desc(receipt.receivedOn));
  const received = receipts.filter((r) => !r.canceledAt).reduce((s, r) => s + r.amount, 0);
  const gross = row.s.amountExTax + row.s.taxAmount;
  return { ...row, receipts, received, gross, outstanding: row.s.canceledAt ? 0 : gross - received };
}

/* ---------------- 入金 ---------------- */

const receiptInput = z.object({
  saleId: zUuid("売上"),
  receivedOn: zDate("入金日"),
  amount: zYen("入金額", { min: 1 }),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function addReceipt(db: DB, actor: Actor, raw: z.input<typeof receiptInput>, opts: { bankTransactionId?: string; viaProviderMatch?: boolean } = {}) {
  // 提供者は、担当会社（自社）の銀行取引からの照合（bank.receiveFromTxn で確認済み）に限り入金を登録できる
  const providerOk = actor.role === "PROVIDER" && opts.viaProviderMatch && !!opts.bankTransactionId;
  if (!isCompanyWide(actor) && !providerOk) throw forbidden("入金の登録は経営者・経理のみ可能です");
  const input = parse(receiptInput, raw);
  if (input.receivedOn > todayJst()) throw invalid("未来の日付の入金は登録できません");
  try {
    return await db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: receipt.id, saleId: receipt.saleId }).from(receipt).where(eq(receipt.idempotencyKey, input.idempotencyKey)).limit(1);
      if (dup) return { id: dup.id, duplicated: true };
      const [s] = await tx.select().from(sale).where(eq(sale.id, input.saleId)).for("update");
      if (!s) throw notFound("売上が見つかりません");
      // 同時に同じ入金が登録された場合: 行ロックの待ち明けに再確認（二重登録・誤った残高エラーを防ぐ）
      const [dup2] = await tx.select({ id: receipt.id }).from(receipt).where(eq(receipt.idempotencyKey, input.idempotencyKey)).limit(1);
      if (dup2) return { id: dup2.id, duplicated: true };
      if (s.canceledAt) throw invalid("取消済みの売上には入金を登録できません");
      await assertMonthOpen(tx, input.receivedOn.slice(0, 7), "入金");
      const remaining = s.amountExTax + s.taxAmount - (await receivedTotal(tx, s.id));
      if (input.amount > remaining) throw invalid(`入金額が未収残高（${remaining.toLocaleString()}円）を超えています`);
      const [r] = await tx.insert(receipt).values({ ...input, note: input.note || null, bankTransactionId: opts.bankTransactionId ?? null, createdById: actor.userId }).returning({ id: receipt.id });
      await writeAudit(tx, actor, { action: "receipt.create", entityType: "sale", entityId: s.id, divisionId: s.divisionId, summary: `入金 ${input.amount}円（${input.receivedOn}）を登録。未収残高 ${remaining - input.amount}円` });
      return { id: r.id, duplicated: false };
    });
  } catch (e) {
    if (isUniqueViolation(e, "receipt_idempotency_key_unique")) {
      const [dup] = await db.select({ id: receipt.id }).from(receipt).where(eq(receipt.idempotencyKey, input.idempotencyKey)).limit(1);
      if (dup) return { id: dup.id, duplicated: true };
    }
    throw e;
  }
}

export async function cancelReceipt(db: DB, actor: Actor, id: string, reason: string) {
  if (!isCompanyWide(actor)) throw forbidden();
  const why = parse(zText("取消理由", 500), reason);
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(receipt).where(eq(receipt.id, id)).for("update");
    if (!r || r.canceledAt) throw conflict("この入金は既に取消済みか、存在しません");
    await assertMonthOpen(tx, r.receivedOn.slice(0, 7), "入金");
    await tx.update(receipt).set({ canceledAt: new Date(), cancelReason: why }).where(eq(receipt.id, id));
    await writeAudit(tx, actor, { action: "receipt.cancel", entityType: "sale", entityId: r.saleId, summary: `入金 ${r.amount}円を取消: ${why}` });
  });
}

/* ---------------- 支払予定 ---------------- */

export async function listPayables(db: DB, actor: Actor, opts: { status?: string } = {}) {
  if (!isCompanyWide(actor)) throw forbidden("支払予定は経営者・経理のみ閲覧できます");
  return db
    .select({ p: payable, divisionName: division.name })
    .from(payable)
    .leftJoin(division, eq(division.id, payable.divisionId))
    .where(opts.status ? sql`${payable.status} = ${opts.status}` : sql`${payable.status} <> 'CANCELED'`)
    .orderBy(asc(payable.dueDate))
    .limit(500);
}

export async function markPayablePaid(db: DB, actor: Actor, id: string, paidOn: string, bankTransactionId?: string) {
  if (!isCompanyWide(actor)) throw forbidden();
  const date = parse(zDate("支払日"), paidOn);
  await db.transaction(async (tx) => {
    const [p] = await tx.update(payable).set({ status: "PAID", paidOn: date, bankTransactionId: bankTransactionId ?? null }).where(and(eq(payable.id, id), eq(payable.status, "SCHEDULED"))).returning();
    if (!p) throw conflict("この支払予定は既に支払済みか取消済みです");
    await writeAudit(tx, actor, { action: "payable.paid", entityType: "payable", entityId: id, divisionId: p.divisionId, summary: `支払済み: ${p.payeeName} ${p.amount}円（${date}）` });
  });
}

export async function reopenPayable(db: DB, actor: Actor, id: string) {
  if (!isCompanyWide(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [p] = await tx.update(payable).set({ status: "SCHEDULED", paidOn: null, bankTransactionId: null }).where(and(eq(payable.id, id), eq(payable.status, "PAID"))).returning();
    if (!p) throw conflict("支払済みの予定ではありません");
    await writeAudit(tx, actor, { action: "payable.reopen", entityType: "payable", entityId: id, summary: `支払済みを取り消し: ${p.payeeName} ${p.amount}円` });
  });
}

export async function addOtherPayable(db: DB, actor: Actor, raw: { payeeName: string; description: string; amount: string; dueDate: string; divisionId?: string }) {
  if (!isCompanyWide(actor)) throw forbidden();
  const payeeName = parse(zText("支払先", 200), raw.payeeName);
  const description = parse(zText("内容", 200), raw.description);
  const amount = parse(zYen("金額", { min: 1 }), raw.amount);
  const dueDate = parse(zDate("支払予定日"), raw.dueDate);
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(payable).values({ source: "OTHER", payeeName, description, amount, dueDate, divisionId: raw.divisionId || null }).returning({ id: payable.id });
    await writeAudit(tx, actor, { action: "payable.create", entityType: "payable", entityId: p.id, summary: `支払予定を登録: ${payeeName} ${amount}円` });
    return p.id;
  });
}
