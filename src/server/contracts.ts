/**
 * 契約書
 * - テンプレートは版で管理（同じ key の新しい版を作る）。使えるのは経営者が「承認」した版だけ
 * - 契約は 入力フォーム → 承認済みテンプレートに差し込み → プレビュー/PDF
 * - 状態: 下書き → 社内確認済み → 送付済み → 締結済み → 終了。各操作は人が行う（自動締結しない）
 * - 締結済みの契約書ファイル（署名済みPDFなど）を保存。条件の変更は改訂として履歴を残す
 * - 電子署名サービスとの連携は未実装（adapters/esign.ts の差し替えで追加できる設計）
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, contract, contractRevision, contractTemplate, type ContractTerms, division, driver, partner, project, storedFile } from "@/db/schema";
import { deleteObject, putObject, safeName, validateFile } from "@/adapters/storage";
import { type Actor, can, canAccessDivision, divisionScope } from "@/lib/access";
import { DATE_RE, todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { parse, zText } from "./validate";

export const TERM_LABELS: Record<keyof ContractTerms, string> = {
  ordererName: "発注者",
  contractorName: "受注者",
  scope: "業務内容",
  periodStart: "契約開始日",
  periodEnd: "契約終了日",
  fee: "報酬",
  feeMethod: "報酬の計算方法",
  closingDay: "締め日",
  paymentDay: "支払日",
  expenseBurden: "経費の負担",
  renewal: "更新条件",
  termination: "解約条件",
  confidentiality: "秘密保持",
  deliverables: "成果物・報告",
  special: "特記事項",
};
const KEYS = Object.keys(TERM_LABELS) as (keyof ContractTerms)[];
const REQUIRED: (keyof ContractTerms)[] = ["ordererName", "contractorName", "scope", "periodStart", "periodEnd", "fee", "paymentDay"];

/* ---------------- テンプレート ---------------- */

export async function listTemplates(db: DB) {
  return db.select().from(contractTemplate).orderBy(asc(contractTemplate.key), desc(contractTemplate.version));
}

/** テンプレートの新しい版（未確認）を作る */
export async function createTemplateVersion(db: DB, actor: Actor, raw: { key: string; name: string; body: string; note?: string }) {
  if (!can.manageContracts(actor)) throw forbidden();
  const key = parse(z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "種類キーは英小文字・数字・ハイフンで入力してください"), raw.key);
  const name = parse(zText("テンプレート名", 100), raw.name);
  const body = parse(z.string().trim().min(20, "本文を入力してください").max(50_000), raw.body);
  const unknown = [...body.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !KEYS.includes(k as keyof ContractTerms) && !["title", "today"].includes(k));
  if (unknown.length) throw invalid(`使えない差し込み項目があります: ${[...new Set(unknown)].join(", ")}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tpl:${key}`}))`);
    const [{ v }] = (await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int v from contract_template where key = ${key}`)).rows;
    const [t] = await tx.insert(contractTemplate).values({ key, version: v + 1, name, body, note: raw.note?.trim() || null }).returning({ id: contractTemplate.id });
    await writeAudit(tx, actor, { action: "template.create", entityType: "contract_template", entityId: t.id, summary: `契約テンプレート「${name}」第${v + 1}版を作成（未確認）` });
    return t.id;
  });
}

/** テンプレートの承認（経営者のみ）。同じ種類の以前の承認版は「廃止」になる */
export async function approveTemplate(db: DB, actor: Actor, id: string, note: string) {
  if (!can.approveTemplates(actor)) throw forbidden("テンプレートの承認は経営者のみ可能です");
  const why = parse(zText("確認内容（専門家の確認日など）", 500), note);
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(contractTemplate).where(eq(contractTemplate.id, id)).for("update");
    if (!t) throw notFound();
    if (t.status !== "UNREVIEWED") throw conflict("未確認の版だけ承認できます");
    await tx.update(contractTemplate).set({ status: "RETIRED" }).where(and(eq(contractTemplate.key, t.key), eq(contractTemplate.status, "APPROVED")));
    await tx.update(contractTemplate).set({ status: "APPROVED", approvedById: actor.userId, approvedAt: new Date(), note: why }).where(eq(contractTemplate.id, id));
    await writeAudit(tx, actor, { action: "template.approve", entityType: "contract_template", entityId: id, summary: `契約テンプレート「${t.name}」第${t.version}版を承認: ${why}` });
  });
}

export async function retireTemplate(db: DB, actor: Actor, id: string) {
  if (!can.approveTemplates(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [t] = await tx.update(contractTemplate).set({ status: "RETIRED" }).where(eq(contractTemplate.id, id)).returning();
    if (!t) throw notFound();
    await writeAudit(tx, actor, { action: "template.retire", entityType: "contract_template", entityId: id, summary: `契約テンプレート「${t.name}」第${t.version}版を廃止` });
  });
}

/* ---------------- 差し込み ---------------- */

export function mergeTemplate(body: string, terms: Partial<ContractTerms>, title: string) {
  const missing: string[] = [];
  const text = body.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_, k: string) => {
    if (k === "title") return title;
    if (k === "today") return todayJst();
    const v = (terms as Record<string, string>)[k]?.trim();
    if (!v) {
      // 必須項目は未入力として表示。任意項目は「定めなし」
      if (!REQUIRED.includes(k as keyof ContractTerms)) return "（定めなし）";
      missing.push(TERM_LABELS[k as keyof ContractTerms] ?? k);
      return `【未入力: ${TERM_LABELS[k as keyof ContractTerms] ?? k}】`;
    }
    return v;
  });
  return { text, missing: [...new Set(missing)] };
}

/* ---------------- 契約 ---------------- */

const contractInput = z.object({
  title: zText("契約名", 200),
  ourSide: z.enum(["ORDERER", "CONTRACTOR"]),
  partnerId: z.string().uuid("取引先を選んでください"),
  divisionId: z.string().uuid("事業部を選んでください"),
  projectId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  driverUserId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  templateId: z.string().uuid("テンプレートを選んでください"),
  renewalNoticeDays: z.preprocess((v) => (v === "" || v == null ? 30 : v), z.coerce.number().int().min(0).max(365)).optional(),
  terms: z.record(z.string(), z.string()),
});
export type ContractInput = z.input<typeof contractInput>;

function cleanTerms(raw: Record<string, string>): ContractTerms {
  const t = Object.fromEntries(KEYS.map((k) => [k, (raw[k] ?? "").trim().slice(0, 5000)])) as ContractTerms;
  for (const k of ["periodStart", "periodEnd"] as const) if (t[k] && !DATE_RE.test(t[k])) throw invalid(`${TERM_LABELS[k]}は日付で入力してください`);
  if (t.periodStart && t.periodEnd && t.periodEnd < t.periodStart) throw invalid("契約終了日は開始日より後にしてください");
  return t;
}

async function validateRefs(tx: Tx, actor: Actor, input: z.output<typeof contractInput>) {
  if (!can.manageContracts(actor) || !canAccessDivision(actor, input.divisionId)) throw forbidden("この事業部の契約を扱う権限がありません");
  const [p] = await tx.select().from(partner).where(eq(partner.id, input.partnerId)).limit(1);
  if (!p || p.archivedAt) throw notFound("取引先が見つかりません");
  if (input.ourSide === "ORDERER" && !p.isContractor) throw invalid("当社が発注する契約では、委託先として登録された取引先を選んでください");
  if (input.ourSide === "CONTRACTOR" && !p.isCustomer) throw invalid("当社が受注する契約では、顧客として登録された取引先を選んでください");
  if (input.projectId) {
    const [pj] = await tx.select({ divisionId: project.divisionId }).from(project).where(eq(project.id, input.projectId)).limit(1);
    if (!pj || pj.divisionId !== input.divisionId) throw invalid("案件と事業部が一致しません");
  }
  if (input.driverUserId) {
    const [d] = await tx.select({ divisionId: driver.divisionId }).from(driver).where(eq(driver.userId, input.driverUserId)).limit(1);
    if (!d || d.divisionId !== input.divisionId) throw invalid("ドライバーと事業部が一致しません");
  }
  const [t] = await tx.select().from(contractTemplate).where(eq(contractTemplate.id, input.templateId)).limit(1);
  if (!t || t.status !== "APPROVED") throw invalid("承認済みのテンプレートを選んでください（未確認のテンプレートは使えません）");
  return t;
}

export async function createContract(db: DB, actor: Actor, raw: ContractInput) {
  const input = parse(contractInput, raw);
  const terms = cleanTerms(input.terms);
  return db.transaction(async (tx) => {
    const t = await validateRefs(tx, actor, input);
    const { text } = mergeTemplate(t.body, terms, input.title);
    const [c] = await tx
      .insert(contract)
      .values({ title: input.title, ourSide: input.ourSide, partnerId: input.partnerId, divisionId: input.divisionId, projectId: input.projectId ?? null, driverUserId: input.driverUserId ?? null, templateId: t.id, terms, renderedBody: text, periodEnd: terms.periodEnd || null, renewalNoticeDays: input.renewalNoticeDays ?? 30, createdById: actor.userId })
      .returning({ id: contract.id });
    await writeAudit(tx, actor, { action: "contract.create", entityType: "contract", entityId: c.id, divisionId: input.divisionId, summary: `契約「${input.title}」を作成（下書き・テンプレート第${t.version}版）` });
    return c.id;
  });
}

/** 契約内容の変更。下書き・社内確認済みは上書き（確認済みは下書きに戻る）、送付・締結後は改訂（版を上げて履歴を残す） */
export async function updateContract(db: DB, actor: Actor, id: string, raw: ContractInput, reason: string) {
  const input = parse(contractInput, raw);
  const terms = cleanTerms(input.terms);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contract).where(eq(contract.id, id)).for("update");
    if (!c || !canAccessDivision(actor, c.divisionId)) throw notFound("契約が見つかりません");
    if (c.status === "ENDED") throw conflict("終了した契約は変更できません");
    if (input.divisionId !== c.divisionId) throw invalid("契約の事業部は変更できません。新しい契約書を作成してください");
    const t = await validateRefs(tx, actor, input);
    const revise = c.status === "SENT" || c.status === "SIGNED";
    const why = revise ? parse(zText("改訂の理由", 500), reason) : reason.trim() || "下書きの修正";
    await tx.insert(contractRevision).values({ contractId: id, revision: c.revision, terms: c.terms, renderedBody: c.renderedBody, templateId: c.templateId, reason: why, createdById: actor.userId });
    const { text } = mergeTemplate(t.body, terms, input.title);
    await tx
      .update(contract)
      .set({ title: input.title, ourSide: input.ourSide, partnerId: input.partnerId, projectId: input.projectId ?? null, driverUserId: input.driverUserId ?? null, templateId: t.id, terms, renderedBody: text, periodEnd: terms.periodEnd || null, renewalNoticeDays: input.renewalNoticeDays ?? 30, revision: c.revision + 1, status: "DRAFT", reviewedAt: null, reviewedById: null, ...(revise ? { sentAt: null, signedAt: null, signedFileId: null } : {}), updatedAt: new Date() })
      .where(eq(contract.id, id));
    await writeAudit(tx, actor, { action: revise ? "contract.revise" : "contract.update", entityType: "contract", entityId: id, divisionId: c.divisionId, summary: `契約「${input.title}」を${revise ? "改訂（新しい版は下書き。締結し直しが必要）" : "修正"}（第${c.revision}版→第${c.revision + 1}版）: ${why}` });
  });
}

/** 状態の変更（すべて人の操作。締結済みにするには締結済みファイルが必要） */
export async function setContractStatus(db: DB, actor: Actor, id: string, to: "REVIEWED" | "SENT" | "SIGNED" | "ENDED" | "DRAFT") {
  if (!can.manageContracts(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(contract).where(eq(contract.id, id)).for("update");
    if (!c || !canAccessDivision(actor, c.divisionId)) throw notFound("契約が見つかりません");
    const allowed: Record<string, string[]> = { REVIEWED: ["DRAFT"], DRAFT: ["REVIEWED"], SENT: ["REVIEWED"], SIGNED: ["SENT"], ENDED: ["SIGNED"] };
    if (!allowed[to].includes(c.status)) throw conflict("現在の状態からは変更できません");
    const patch: Partial<typeof contract.$inferInsert> = { status: to, updatedAt: new Date() };
    if (to === "REVIEWED") {
      if (c.createdById === actor.userId && actor.role !== "OWNER") throw forbidden("作成者以外の担当者が社内確認してください");
      const [t] = await tx.select().from(contractTemplate).where(eq(contractTemplate.id, c.templateId)).limit(1);
      const m = mergeTemplate(t.body, c.terms, c.title);
      const req = REQUIRED.filter((k) => !c.terms[k]?.trim()).map((k) => TERM_LABELS[k]);
      if (m.missing.length || req.length) throw invalid(`未入力の項目があります: ${[...new Set([...m.missing, ...req])].join("、")}`);
      patch.reviewedAt = new Date();
      patch.reviewedById = actor.userId;
    }
    if (to === "SENT") patch.sentAt = new Date();
    if (to === "SIGNED") {
      if (!c.signedFileId) throw invalid("締結済みの契約書ファイル（署名済みPDFなど）を先に保存してください");
      patch.signedAt = new Date();
    }
    if (to === "ENDED") patch.endedAt = new Date();
    await tx.update(contract).set(patch).where(eq(contract.id, id));
    await writeAudit(tx, actor, { action: `contract.${to.toLowerCase()}`, entityType: "contract", entityId: id, divisionId: c.divisionId, summary: `契約「${c.title}」を ${to} に変更` });
  });
}

/** 締結済み契約書ファイルの保存（送付済み・締結済みの契約のみ） */
export async function addSignedFile(db: DB, actor: Actor, id: string, file: { name: string; bytes: Uint8Array }) {
  if (!can.manageContracts(actor)) throw forbidden();
  const mime = validateFile(file.bytes);
  if (mime !== "application/pdf" && !mime.startsWith("image/")) throw invalid("PDFまたは画像を保存してください");
  const key = await putObject("contracts", file.bytes, mime);
  try {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(contract).where(eq(contract.id, id)).for("update");
      if (!c || !canAccessDivision(actor, c.divisionId)) throw notFound("契約が見つかりません");
      if (c.status !== "SENT" && c.status !== "SIGNED") throw conflict("送付済み・締結済みの契約にだけ保存できます");
      const [f] = await tx.insert(storedFile).values({ storageKey: key, originalName: safeName(file.name), mimeType: mime, size: file.bytes.length, ownerType: "CONTRACT", ownerId: id, uploadedById: actor.userId }).returning({ id: storedFile.id });
      await tx.update(contract).set({ signedFileId: f.id, updatedAt: new Date() }).where(eq(contract.id, id));
      await writeAudit(tx, actor, { action: "contract.file", entityType: "contract", entityId: id, divisionId: c.divisionId, summary: `契約「${c.title}」の締結済みファイルを保存` });
    });
  } catch (e) {
    await deleteObject(key);
    throw e;
  }
}

export async function listContracts(db: DB, actor: Actor, opts: { status?: string; divisionId?: string } = {}) {
  const scope = actor.role === "DRIVER" ? null : divisionScope(actor);
  return db
    .select({ c: contract, partnerName: partner.name, divisionName: division.name, driverName: appUser.name })
    .from(contract)
    .innerJoin(partner, eq(partner.id, contract.partnerId))
    .innerJoin(division, eq(division.id, contract.divisionId))
    .leftJoin(appUser, eq(appUser.id, contract.driverUserId))
    .where(
      and(
        actor.role === "DRIVER" ? and(eq(contract.driverUserId, actor.userId), inArray(contract.status, ["SIGNED", "ENDED"])) : undefined,
        scope ? (scope.length ? inArray(contract.divisionId, scope) : sql`false`) : undefined,
        opts.status ? sql`${contract.status} = ${opts.status}` : undefined,
        opts.divisionId ? eq(contract.divisionId, opts.divisionId) : undefined,
      ),
    )
    .orderBy(desc(contract.updatedAt))
    .limit(300);
}

export async function getContract(db: DB, actor: Actor, id: string) {
  const [r] = await db
    .select({ c: contract, partnerName: partner.name, divisionName: division.name, template: contractTemplate })
    .from(contract)
    .innerJoin(partner, eq(partner.id, contract.partnerId))
    .innerJoin(division, eq(division.id, contract.divisionId))
    .innerJoin(contractTemplate, eq(contractTemplate.id, contract.templateId))
    .where(eq(contract.id, id))
    .limit(1);
  const visible = r && (actor.role === "DRIVER" ? r.c.driverUserId === actor.userId && (r.c.status === "SIGNED" || r.c.status === "ENDED") : canAccessDivision(actor, r.c.divisionId));
  if (!r || !visible) throw notFound("契約が見つかりません");
  const revisions = actor.role === "DRIVER" ? [] : await db.select().from(contractRevision).where(eq(contractRevision.contractId, id)).orderBy(desc(contractRevision.revision));
  const files = await db.select({ id: storedFile.id, name: storedFile.originalName, createdAt: storedFile.createdAt }).from(storedFile).where(and(eq(storedFile.ownerType, "CONTRACT"), eq(storedFile.ownerId, id))).orderBy(desc(storedFile.createdAt));
  const merge = mergeTemplate(r.template.body, r.c.terms, r.c.title);
  return { ...r, revisions, files, missing: merge.missing };
}

export async function approvedTemplates(db: DB) {
  return db.select({ id: contractTemplate.id, name: contractTemplate.name, version: contractTemplate.version }).from(contractTemplate).where(eq(contractTemplate.status, "APPROVED")).orderBy(asc(contractTemplate.name));
}


