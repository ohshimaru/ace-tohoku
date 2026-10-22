/** 取引先（顧客・業務委託先）と案件 */
import { and, asc, desc, eq, exists, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { contract, division, partner, partnerDivision, partnerNote, project, type ReportFieldConfig } from "@/db/schema";
import { type Actor, canAccessDivision, divisionScope, isStaff } from "@/lib/access";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { diff, writeAudit } from "./audit";
import { likePattern, pageParams, parse, zOptDate, zOptText, zText, zUuid, zYen } from "./validate";

function requireStaffActor(a: Actor) {
  if (!isStaff(a)) throw forbidden();
}

/** 責任者が見られる取引先: 担当事業部に紐付く取引先、または担当事業部の案件の顧客 */
export function visiblePartnersWhere(actor: Actor): SQL | undefined {
  const scope = divisionScope(actor);
  if (!scope) return undefined;
  if (!scope.length) return sql`false`;
  return or(
    exists(sql`(select 1 from ${partnerDivision} pd where pd.partner_id = ${partner.id} and pd.division_id in ${scope})`),
    exists(sql`(select 1 from ${project} pj where pj.customer_id = ${partner.id} and pj.division_id in ${scope})`),
  );
}

const partnerInput = z
  .object({
    type: z.enum(["CORPORATION", "INDIVIDUAL"]),
    name: zText("名称", 200),
    nameKana: zOptText("フリガナ", 200),
    postalCode: zOptText("郵便番号", 10),
    address: zOptText("住所", 300),
    phone: zOptText("電話番号", 30),
    email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().email("メールアドレスの形式が正しくありません").optional()).optional(),
    contactName: zOptText("担当者", 100),
    billingInfo: zOptText("請求情報", 1000),
    isCustomer: z.coerce.boolean(),
    isContractor: z.coerce.boolean(),
    divisionIds: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.isCustomer || v.isContractor, { message: "「顧客」「業務委託先」の少なくとも一方を選んでください" });

export type PartnerInput = z.input<typeof partnerInput>;

async function assertDivisionsAllowed(actor: Actor, ids: string[]) {
  for (const d of ids) if (!canAccessDivision(actor, d)) throw forbidden("担当外の事業部は選べません");
}

export async function listPartners(db: DB, actor: Actor, opts: { q?: string; role?: string; divisionId?: string; archived?: boolean; page?: string } = {}) {
  requireStaffActor(actor);
  const { limit, offset, page } = pageParams(opts.page);
  const conds: (SQL | undefined)[] = [visiblePartnersWhere(actor), opts.archived ? isNotNull(partner.archivedAt) : isNull(partner.archivedAt)];
  if (opts.q) conds.push(or(ilike(partner.name, likePattern(opts.q)), ilike(partner.nameKana, likePattern(opts.q))));
  if (opts.role === "customer") conds.push(eq(partner.isCustomer, true));
  if (opts.role === "contractor") conds.push(eq(partner.isContractor, true));
  if (opts.divisionId) conds.push(exists(sql`(select 1 from ${partnerDivision} pd where pd.partner_id = ${partner.id} and pd.division_id = ${opts.divisionId})`));
  const where = and(...conds);
  const rows = await db
    .select({
      id: partner.id,
      type: partner.type,
      name: partner.name,
      isCustomer: partner.isCustomer,
      isContractor: partner.isContractor,
      phone: partner.phone,
      contactName: partner.contactName,
      divisions: sql<string>`coalesce((select string_agg(d.name, '・' order by d.sort_order) from partner_division pd join division d on d.id = pd.division_id where pd.partner_id = ${partner.id}), '')`,
      projectCount: sql<number>`(select count(*)::int from project p where p.customer_id = ${partner.id} and p.archived_at is null)`,
    })
    .from(partner)
    .where(where)
    .orderBy(asc(partner.name))
    .limit(limit)
    .offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(partner).where(where);
  return { rows, total, page, limit };
}

export async function getPartner(db: DB, actor: Actor, id: string) {
  requireStaffActor(actor);
  const [p] = await db.select().from(partner).where(and(eq(partner.id, id), visiblePartnersWhere(actor))).limit(1);
  if (!p) throw notFound("取引先が見つかりません");
  const scope = divisionScope(actor);
  const divisionIds = (await db.select({ id: partnerDivision.divisionId }).from(partnerDivision).where(eq(partnerDivision.partnerId, id))).map((d) => d.id);
  const projects = await db
    .select({ id: project.id, code: project.code, name: project.name, status: project.status, contractType: project.contractType, divisionName: division.name })
    .from(project)
    .innerJoin(division, eq(division.id, project.divisionId))
    .where(and(eq(project.customerId, id), scope ? inArray(project.divisionId, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]) : undefined))
    .orderBy(desc(project.createdAt));
  const contracts = await db
    .select({ id: contract.id, title: contract.title, status: contract.status, periodEnd: contract.periodEnd })
    .from(contract)
    .where(and(eq(contract.partnerId, id), scope ? inArray(contract.divisionId, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]) : undefined))
    .orderBy(desc(contract.createdAt));
  const notes = await db
    .select()
    .from(partnerNote)
    .where(and(eq(partnerNote.partnerId, id), scope ? or(isNull(partnerNote.divisionId), inArray(partnerNote.divisionId, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"])) : undefined))
    .orderBy(desc(partnerNote.createdAt));
  return { partner: p, divisionIds, projects, contracts, notes };
}

export async function savePartner(db: DB, actor: Actor, id: string | null, raw: PartnerInput) {
  requireStaffActor(actor);
  const input = parse(partnerInput, raw);
  await assertDivisionsAllowed(actor, input.divisionIds);
  if (divisionScope(actor) && input.divisionIds.length === 0) throw invalid("担当事業部を1つ以上選んでください");
  const { divisionIds, ...fields } = input;
  const values = { ...fields, nameKana: fields.nameKana ?? null, postalCode: fields.postalCode ?? null, address: fields.address ?? null, phone: fields.phone ?? null, email: fields.email ?? null, contactName: fields.contactName ?? null, billingInfo: fields.billingInfo ?? null };
  return db.transaction(async (tx) => {
    if (id) {
      const [before] = await tx.select().from(partner).where(and(eq(partner.id, id), visiblePartnersWhere(actor))).for("update");
      if (!before) throw notFound("取引先が見つかりません");
      await tx.update(partner).set(values).where(eq(partner.id, id));
      // 責任者は自分の担当事業部の紐付けだけを変更できる
      const scope = divisionScope(actor);
      if (scope) await tx.delete(partnerDivision).where(and(eq(partnerDivision.partnerId, id), inArray(partnerDivision.divisionId, scope)));
      else await tx.delete(partnerDivision).where(eq(partnerDivision.partnerId, id));
      if (divisionIds.length) await tx.insert(partnerDivision).values(divisionIds.map((d) => ({ partnerId: id, divisionId: d }))).onConflictDoNothing();
      await writeAudit(tx, actor, { action: "partner.update", entityType: "partner", entityId: id, summary: `取引先「${input.name}」を更新`, changes: diff(before as unknown as Record<string, unknown>, values) });
      return id;
    }
    const [dup] = await tx.select({ id: partner.id }).from(partner).where(and(eq(partner.name, input.name), isNull(partner.archivedAt))).limit(1);
    if (dup) throw conflict(`同じ名前の取引先「${input.name}」が既に登録されています`);
    const [p] = await tx.insert(partner).values(values).returning({ id: partner.id });
    if (divisionIds.length) await tx.insert(partnerDivision).values(divisionIds.map((d) => ({ partnerId: p.id, divisionId: d })));
    await writeAudit(tx, actor, { action: "partner.create", entityType: "partner", entityId: p.id, summary: `取引先「${input.name}」を登録` });
    return p.id;
  });
}

export async function addPartnerNote(db: DB, actor: Actor, partnerId: string, raw: { body: string; divisionId?: string }) {
  requireStaffActor(actor);
  const body = parse(zText("対応メモ", 2000), raw.body);
  const divisionId = raw.divisionId || null;
  if (divisionScope(actor) && !divisionId) throw invalid("メモの事業部を選んでください");
  if (divisionId && !canAccessDivision(actor, divisionId)) throw forbidden();
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ id: partner.id }).from(partner).where(and(eq(partner.id, partnerId), visiblePartnersWhere(actor))).limit(1);
    if (!p) throw notFound("取引先が見つかりません");
    await tx.insert(partnerNote).values({ partnerId, divisionId, body, authorId: actor.userId });
  });
}

export async function setPartnerArchived(db: DB, actor: Actor, id: string, archived: boolean) {
  requireStaffActor(actor);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(partner).where(and(eq(partner.id, id), visiblePartnersWhere(actor))).for("update");
    if (!p) throw notFound("取引先が見つかりません");
    await tx.update(partner).set({ archivedAt: archived ? new Date() : null }).where(eq(partner.id, id));
    await writeAudit(tx, actor, { action: archived ? "partner.archive" : "partner.restore", entityType: "partner", entityId: id, summary: `取引先「${p.name}」を${archived ? "アーカイブ" : "復元"}` });
  });
}

export async function partnerOptions(db: Tx, actor: Actor, role: "customer" | "contractor" | "any" = "any") {
  return db
    .select({ id: partner.id, name: partner.name })
    .from(partner)
    .where(and(isNull(partner.archivedAt), visiblePartnersWhere(actor), role === "customer" ? eq(partner.isCustomer, true) : role === "contractor" ? eq(partner.isContractor, true) : undefined))
    .orderBy(asc(partner.name));
}

/* ================================================================== */
/* 案件                                                                 */
/* ================================================================== */

export function visibleProjectsWhere(actor: Actor): SQL | undefined {
  const scope = divisionScope(actor);
  if (!scope) return undefined;
  return scope.length ? inArray(project.divisionId, scope) : sql`false`;
}

export async function assertProjectAccess(db: Tx, actor: Actor, projectId: string) {
  const [p] = await db.select().from(project).where(and(eq(project.id, projectId), visibleProjectsWhere(actor))).limit(1);
  if (!p) throw notFound("案件が見つかりません");
  return p;
}

const projectInput = z
  .object({
    code: zText("案件コード", 30).regex(/^[A-Za-z0-9_-]+$/, "案件コードは英数字・ハイフンで入力してください"),
    name: zText("案件名", 200),
    divisionId: zUuid("事業部"),
    customerId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
    category: z.string().trim().max(50).default(""),
    contractType: z.enum(["MONTHLY", "ONE_OFF"]),
    amount: zYen("契約金額"),
    startDate: zOptDate("開始日"),
    endDate: zOptDate("終了日"),
    dueDate: zOptDate("納期"),
    status: z.enum(["PROSPECT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELED"]),
    rfQuantity: z.coerce.boolean().default(false),
    rfQuantityUnit: z.string().trim().max(10).default("件"),
    rfDistance: z.coerce.boolean().default(false),
    rfBreakTime: z.coerce.boolean().default(true),
    rfAttachments: z.coerce.boolean().default(true),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "終了日は開始日以降にしてください" });

export type ProjectInput = z.input<typeof projectInput>;

export async function saveProject(db: DB, actor: Actor, id: string | null, raw: ProjectInput) {
  requireStaffActor(actor);
  const input = parse(projectInput, raw);
  if (!canAccessDivision(actor, input.divisionId)) throw forbidden("担当外の事業部の案件は登録できません");
  const reportFields: ReportFieldConfig = { quantity: input.rfQuantity, quantityUnit: input.rfQuantityUnit || "件", distance: input.rfDistance, breakTime: input.rfBreakTime, attachments: input.rfAttachments };
  const values = {
    code: input.code,
    name: input.name,
    divisionId: input.divisionId,
    customerId: input.customerId ?? null,
    category: input.category,
    contractType: input.contractType,
    amount: input.amount,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status,
    reportFields,
  };
  try {
    return await db.transaction(async (tx) => {
      if (values.customerId) {
        const [c] = await tx.select({ isCustomer: partner.isCustomer }).from(partner).where(and(eq(partner.id, values.customerId), visiblePartnersWhere(actor))).limit(1);
        if (!c) throw notFound("顧客が見つかりません");
        if (!c.isCustomer) throw invalid("選んだ取引先は「顧客」として登録されていません");
      }
      if (id) {
        const [before] = await tx.select().from(project).where(and(eq(project.id, id), visibleProjectsWhere(actor))).for("update");
        if (!before) throw notFound("案件が見つかりません");
        if (before.externalSource && before.divisionId !== values.divisionId) throw invalid("外部連携の案件は事業部を変更できません");
        await tx.update(project).set(values).where(eq(project.id, id));
        await writeAudit(tx, actor, { action: "project.update", entityType: "project", entityId: id, divisionId: values.divisionId, summary: `案件「${input.code}」を更新`, changes: diff(before as unknown as Record<string, unknown>, values) });
        return id;
      }
      const [p] = await tx.insert(project).values(values).returning({ id: project.id });
      await writeAudit(tx, actor, { action: "project.create", entityType: "project", entityId: p.id, divisionId: values.divisionId, summary: `案件「${input.code} ${input.name}」を登録` });
      return p.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`案件コード「${input.code}」は既に使われています`);
    throw e;
  }
}

export async function listProjects(db: DB, actor: Actor, opts: { q?: string; divisionId?: string; status?: string; page?: string } = {}) {
  requireStaffActor(actor);
  const { limit, offset, page } = pageParams(opts.page);
  const conds: (SQL | undefined)[] = [visibleProjectsWhere(actor), isNull(project.archivedAt)];
  if (opts.q) conds.push(or(ilike(project.name, likePattern(opts.q)), ilike(project.code, likePattern(opts.q))));
  if (opts.divisionId) conds.push(eq(project.divisionId, opts.divisionId));
  if (opts.status) conds.push(sql`${project.status} = ${opts.status}`);
  const where = and(...conds);
  const rows = await db
    .select({
      id: project.id,
      code: project.code,
      name: project.name,
      category: project.category,
      contractType: project.contractType,
      amount: project.amount,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      dueDate: project.dueDate,
      divisionId: project.divisionId,
      divisionName: division.name,
      customerName: partner.name,
      externalSource: project.externalSource,
    })
    .from(project)
    .innerJoin(division, eq(division.id, project.divisionId))
    .leftJoin(partner, eq(partner.id, project.customerId))
    .where(where)
    .orderBy(asc(division.sortOrder), desc(project.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(project).where(where);
  return { rows, total, page, limit };
}

export async function getProject(db: DB, actor: Actor, id: string) {
  requireStaffActor(actor);
  const [row] = await db
    .select({ project, divisionName: division.name, divisionKind: division.kind, customerName: partner.name })
    .from(project)
    .innerJoin(division, eq(division.id, project.divisionId))
    .leftJoin(partner, eq(partner.id, project.customerId))
    .where(and(eq(project.id, id), visibleProjectsWhere(actor)))
    .limit(1);
  if (!row) throw notFound("案件が見つかりません");
  return row;
}

export async function projectOptions(db: Tx, actor: Actor, divisionId?: string) {
  return db
    .select({ id: project.id, code: project.code, name: project.name, divisionId: project.divisionId })
    .from(project)
    .where(and(isNull(project.archivedAt), visibleProjectsWhere(actor), divisionId ? eq(project.divisionId, divisionId) : undefined, inArray(project.status, ["PROSPECT", "ACTIVE", "PAUSED"])))
    .orderBy(asc(project.code));
}
