/** 会社設定・事業部・費目・利用者（会社側） */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, companySetting, division, driver, expenseCategory, userDivision } from "@/db/schema";
import { type Actor, can, divisionScope } from "@/lib/access";
import { hashPassword } from "@/lib/crypto";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { diff, writeAudit } from "./audit";
import { revokeUserSessions } from "./auth";
import { parse, zOptText, zText } from "./validate";

export async function getSettings(db: Tx) {
  const [s] = await db.select().from(companySetting).where(eq(companySetting.id, 1)).limit(1);
  if (!s) throw new Error("会社設定がありません（マイグレーション未実行）");
  return s;
}

const settingsInput = z.object({
  companyName: zText("会社名", 100),
  appName: zText("アプリ名", 50),
  fiscalYearStartMonth: z.coerce.number().int().min(1, "会計年度の開始月は1〜12").max(12, "会計年度の開始月は1〜12"),
  taxRounding: z.enum(["FLOOR", "ROUND", "CEIL"]),
  issuerAddress: zOptText("住所", 300),
  registrationNumber: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().regex(/^T\d{13}$/, "登録番号は T + 13桁").optional()).optional(),
  reserveSubmittedExpenses: z.coerce.boolean(),
  reserveCommitments: z.coerce.boolean(),
  cashHorizonDays: z.coerce.number().int().min(7).max(180),
  cashWarningThreshold: z.coerce.number().int().min(0),
  outsourcingRatioLimit: z.coerce.number().int().min(1).max(100),
  statementPayDay: z.coerce.number().int().min(1).max(31),
  cleanupUrl: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().url("Clean Up のURLは https:// から入力してください").refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "https:// のURLを入力してください").optional()).optional(),
});

export async function updateSettings(db: DB, actor: Actor, raw: z.input<typeof settingsInput>) {
  if (!can.administer(actor)) throw forbidden("会社設定は経営者・会社管理者のみ変更できます");
  const input = parse(settingsInput, raw);
  const values = { ...input, issuerAddress: input.issuerAddress ?? "", registrationNumber: input.registrationNumber ?? "", cleanupUrl: input.cleanupUrl ?? "" };
  await db.transaction(async (tx) => {
    const before = await getSettings(tx);
    await tx.update(companySetting).set(values).where(eq(companySetting.id, 1));
    await writeAudit(tx, actor, { action: "settings.update", entityType: "company_setting", entityId: "1", summary: "会社設定を更新", changes: diff(before as unknown as Record<string, unknown>, values) });
  });
}

/* ---------------- 事業部 ---------------- */

export async function listDivisions(db: Tx, actor?: Actor, opts: { includeArchived?: boolean } = {}) {
  const scope = actor ? divisionScope(actor) : null;
  return db
    .select()
    .from(division)
    .where(and(opts.includeArchived ? undefined : isNull(division.archivedAt), scope ? (scope.length ? inArray(division.id, scope) : sql`false`) : undefined))
    .orderBy(asc(division.sortOrder), asc(division.name));
}

const divisionInput = z.object({
  code: zText("事業部コード", 20).regex(/^[A-Za-z0-9_-]+$/, "事業部コードは英数字で入力してください"),
  name: zText("事業部名", 50),
  kind: z.enum(["GENERAL", "DRIVER", "CLEANING"]),
  sortOrder: z.coerce.number().int().default(0),
  outsourcingRatioLimit: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(100).optional()).optional(),
});

export async function saveDivision(db: DB, actor: Actor, id: string | null, raw: z.input<typeof divisionInput>) {
  if (!can.administer(actor)) throw forbidden("事業部の追加・編集は経営者・会社管理者のみ可能です");
  const input = parse(divisionInput, raw);
  const values = { ...input, outsourcingRatioLimit: input.outsourcingRatioLimit ?? null };
  try {
    return await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(division).where(eq(division.id, id)).for("update");
        if (!before) throw notFound("事業部が見つかりません");
        await tx.update(division).set(values).where(eq(division.id, id));
        await writeAudit(tx, actor, { action: "division.update", entityType: "division", entityId: id, divisionId: id, summary: `事業部「${input.name}」を更新`, changes: diff(before as unknown as Record<string, unknown>, values) });
        return id;
      }
      const [d] = await tx.insert(division).values(values).returning({ id: division.id });
      await writeAudit(tx, actor, { action: "division.create", entityType: "division", entityId: d.id, divisionId: d.id, summary: `事業部「${input.name}」を追加` });
      return d.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("同じコードまたは名前の事業部があります");
    throw e;
  }
}

export async function setDivisionArchived(db: DB, actor: Actor, id: string, archived: boolean) {
  if (!can.administer(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [d] = await tx.update(division).set({ archivedAt: archived ? new Date() : null }).where(eq(division.id, id)).returning();
    if (!d) throw notFound("事業部が見つかりません");
    await writeAudit(tx, actor, { action: archived ? "division.archive" : "division.restore", entityType: "division", entityId: id, divisionId: id, summary: `事業部「${d.name}」を${archived ? "無効化" : "再開"}` });
  });
}

/* ---------------- 費目 ---------------- */

export async function listCategories(db: Tx) {
  return db.select().from(expenseCategory).where(isNull(expenseCategory.archivedAt)).orderBy(asc(expenseCategory.sortOrder), asc(expenseCategory.name));
}

export async function saveCategory(db: DB, actor: Actor, raw: { name: string; isOutsourcing?: boolean; sortOrder?: number }) {
  if (!can.administer(actor)) throw forbidden();
  const name = parse(zText("費目名", 50), raw.name);
  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx.insert(expenseCategory).values({ name, isOutsourcing: !!raw.isOutsourcing, sortOrder: Number(raw.sortOrder) || 0 }).returning({ id: expenseCategory.id });
      await writeAudit(tx, actor, { action: "category.create", entityType: "expense_category", entityId: c.id, summary: `費目「${name}」を追加` });
      return c.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("同じ名前の費目があります");
    throw e;
  }
}

/* ---------------- 会社側の利用者 ---------------- */

const staffInput = z.object({
  name: zText("氏名", 100),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
  role: z.enum(["OWNER", "ACCOUNTING", "MANAGER"]),
  divisionIds: z.array(z.string().uuid()).default([]),
});

export async function listStaff(db: DB, actor: Actor) {
  if (!can.administer(actor)) throw forbidden("利用者の管理は経営者・会社管理者のみ可能です");
  const users = await db.select().from(appUser).where(and(inArray(appUser.role, ["OWNER", "ACCOUNTING", "MANAGER"]), actor.companyId ? eq(appUser.companyId, actor.companyId) : sql`false`)).orderBy(asc(appUser.role), asc(appUser.name));
  const divs = await db.select().from(userDivision);
  return users.map((u) => ({ ...u, passwordHash: undefined, divisionIds: divs.filter((d) => d.userId === u.id).map((d) => d.divisionId) }));
}

export async function createStaff(db: DB, actor: Actor, raw: z.input<typeof staffInput> & { password: string }) {
  if (!can.administer(actor)) throw forbidden("利用者の追加は経営者・会社管理者のみ可能です");
  const input = parse(staffInput, raw);
  if (input.role === "MANAGER" && input.divisionIds.length === 0) throw invalid("事業部責任者には担当事業部を1つ以上選んでください");
  const hash = await hashPassword(raw.password ?? "");
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx.insert(appUser).values({ name: input.name, email: input.email, passwordHash: hash, role: input.role, companyId: actor.companyId, status: "ACTIVE", emailVerifiedAt: new Date(), approvedAt: new Date(), approvedById: actor.userId }).returning({ id: appUser.id });
      if (input.role === "MANAGER") await tx.insert(userDivision).values(input.divisionIds.map((divisionId) => ({ userId: u.id, divisionId })));
      await writeAudit(tx, actor, { action: "user.create", entityType: "app_user", entityId: u.id, summary: `利用者「${input.name}」（${input.role}）を追加` });
      return u.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("このメールアドレスは既に使われています");
    throw e;
  }
}

export async function updateStaff(db: DB, actor: Actor, id: string, raw: { role: string; divisionIds: string[]; status: string }) {
  if (!can.administer(actor)) throw forbidden();
  const role = parse(z.enum(["OWNER", "ACCOUNTING", "MANAGER"]), raw.role);
  const status = parse(z.enum(["ACTIVE", "SUSPENDED"]), raw.status);
  const divisionIds = parse(z.array(z.string().uuid()), raw.divisionIds ?? []);
  if (role === "MANAGER" && divisionIds.length === 0) throw invalid("事業部責任者には担当事業部を1つ以上選んでください");
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(appUser).where(eq(appUser.id, id)).for("update");
    // ドライバー・サービス提供者・他社の利用者は本社から変更できない（提供者の権限は運営側のコマンドでのみ設定）
    if (!u || u.role === "DRIVER" || u.role === "PROVIDER" || u.companyId !== actor.companyId) throw notFound("利用者が見つかりません");
    if (u.id === actor.userId && (role !== "OWNER" || status !== "ACTIVE")) throw invalid("自分自身の管理者権限を外したり停止したりはできません");
    if (u.role === "OWNER" && (role !== "OWNER" || status !== "ACTIVE")) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(appUser).where(and(eq(appUser.role, "OWNER"), eq(appUser.status, "ACTIVE"), sql`${appUser.id} <> ${id}`));
      if (n === 0) throw invalid("有効な経営者・会社管理者が1人もいなくなるため変更できません");
    }
    await tx.update(appUser).set({ role, status }).where(eq(appUser.id, id));
    await tx.delete(userDivision).where(eq(userDivision.userId, id));
    if (role === "MANAGER") await tx.insert(userDivision).values(divisionIds.map((divisionId) => ({ userId: id, divisionId })));
    if (status === "SUSPENDED" || role !== u.role) await revokeUserSessions(tx, id);
    await writeAudit(tx, actor, { action: "user.update", entityType: "app_user", entityId: id, summary: `利用者「${u.name}」の権限を更新`, changes: { role: { from: u.role, to: role }, status: { from: u.status, to: status }, divisionIds } });
  });
}

/** 事業部の稼働中ドライバー数（予算の人数連動に使う） */
export async function countActiveDrivers(db: Tx, divisionId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(driver)
    .innerJoin(appUser, eq(appUser.id, driver.userId))
    .where(and(eq(driver.divisionId, divisionId), eq(appUser.status, "ACTIVE")));
  return n;
}

export async function countDivisionManagers(db: Tx, divisionId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userDivision)
    .innerJoin(appUser, eq(appUser.id, userDivision.userId))
    .where(and(eq(userDivision.divisionId, divisionId), eq(appUser.status, "ACTIVE")));
  return n;
}

/* ---------------- 共通経費の配賦ルール ---------------- */

export async function saveAllocationRule(db: DB, actor: Actor, raw: { name: string; method: string; categoryId?: string; effectiveFrom: string; effectiveTo?: string; priority?: string; shares: Record<string, string> }) {
  if (!can.administer(actor)) throw forbidden("配賦ルールの設定は経営者・会社管理者のみ可能です");
  const name = parse(zText("ルール名", 100), raw.name);
  const method = parse(z.enum(["NONE", "FIXED_RATIO", "SALES_RATIO"]), raw.method);
  const from = parse(z.string().regex(/^\d{4}-\d{2}$/, "適用開始月を選んでください"), raw.effectiveFrom);
  const to = raw.effectiveTo ? parse(z.string().regex(/^\d{4}-\d{2}$/), raw.effectiveTo) : null;
  if (to && to < from) throw invalid("適用終了月は開始月以降にしてください");
  const shares = Object.entries(raw.shares)
    .map(([divisionId, v]) => ({ divisionId, ratioBp: Math.round(Number(v || 0) * 100) }))
    .filter((s) => s.ratioBp > 0);
  if (method === "FIXED_RATIO") {
    if (shares.some((s) => !Number.isFinite(s.ratioBp) || s.ratioBp < 0 || s.ratioBp > 10000)) throw invalid("割合は0〜100%で入力してください");
    const sum = shares.reduce((s, x) => s + x.ratioBp, 0);
    if (sum === 0) throw invalid("固定割合は少なくとも1つの事業部に入力してください");
    if (sum > 10000) throw invalid(`割合の合計が100%を超えています（${sum / 100}%）`);
  }
  return db.transaction(async (tx) => {
    const { allocationRule, allocationShare } = await import("@/db/schema");
    const [r] = await tx.insert(allocationRule).values({ name, method, categoryId: raw.categoryId || null, effectiveFrom: from, effectiveTo: to, priority: Number(raw.priority) || 0 }).returning({ id: allocationRule.id });
    if (method === "FIXED_RATIO") await tx.insert(allocationShare).values(shares.map((s) => ({ ruleId: r.id, ...s })));
    await writeAudit(tx, actor, { action: "allocation.create", entityType: "allocation_rule", entityId: r.id, summary: `配賦ルール「${name}」を作成（${method}）`, changes: { shares } });
    return r.id;
  });
}

export async function endAllocationRule(db: DB, actor: Actor, id: string, month: string) {
  if (!can.administer(actor)) throw forbidden();
  const m = parse(z.string().regex(/^\d{4}-\d{2}$/, "終了月を選んでください"), month);
  await db.transaction(async (tx) => {
    const { allocationRule } = await import("@/db/schema");
    const [r] = await tx.update(allocationRule).set({ effectiveTo: m }).where(eq(allocationRule.id, id)).returning();
    if (!r) throw notFound();
    if (m < r.effectiveFrom) throw invalid("終了月は開始月以降にしてください");
    await writeAudit(tx, actor, { action: "allocation.end", entityType: "allocation_rule", entityId: id, summary: `配賦ルール「${r.name}」を ${m} で終了` });
  });
}

export async function listAuditLogs(db: DB, actor: Actor, opts: { page?: string; entityType?: string } = {}) {
  if (!can.administer(actor)) throw forbidden("監査ログは経営者・会社管理者のみ閲覧できます");
  const { auditLog } = await import("@/db/schema");
  const { desc: d } = await import("drizzle-orm");
  const page = Math.max(1, Number(opts.page) || 1);
  // 入出金・銀行・公開設定の履歴は提供者だけが見る（本社の監査ログに非公開取引の内容を出さない）
  const finance = sql`${auditLog.entityType} not in ('bank_transaction', 'bank_account', 'disclosure_policy', 'finance_export') and ${auditLog.action} not like 'bank.%'`;
  const where = opts.entityType ? and(eq(auditLog.entityType, opts.entityType), finance) : finance;
  const rows = await db.select().from(auditLog).where(where).orderBy(d(auditLog.id)).limit(50).offset((page - 1) * 50);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where);
  return { rows, total, page, limit: 50 };
}
