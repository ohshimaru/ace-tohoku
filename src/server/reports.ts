/**
 * 日報（ドライバー）
 * 下書き → 提出 → 承認 / 差戻し（修正して再提出）
 * - 確定スケジュールから初期値を入力できる
 * - 案件の設定で不要な項目（数量・距離・休憩・添付）は表示しない・保存しない
 * - 承認後の訂正は会社側が理由を記録して行い、訂正前の内容を履歴に残す。確定済みの稼働明細に含まれる日報は訂正不可
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, assignment, dailyReport, dailyReportRevision, driver, project, shiftSlot, statement, storedFile } from "@/db/schema";
import { deleteObject, putObject, safeName, validateFile } from "@/adapters/storage";
import { type Actor, canAccessDivision, divisionScope } from "@/lib/access";
import { addDays, DATE_RE, todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { parse, zText } from "./validate";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function isExclusionViolation(e: unknown) {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur === "object" && cur && "code" in cur && (cur as { code: string }).code === "23P01") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const reportInput = z.object({
  workDate: z.string().regex(DATE_RE, "稼働日を入力してください"),
  projectId: z.string().uuid("案件を選んでください"),
  startTime: z.string().regex(TIME_RE, "開始時刻を入力してください"),
  endTime: z.string().regex(TIME_RE, "終了時刻を入力してください"),
  breakMinutes: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().int().min(0, "休憩は0分以上").max(600)),
  quantity: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "数量は小数第2位までの数で入力してください").optional()).optional(),
  distanceKm: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, "走行距離は数で入力してください").optional()).optional(),
  notes: z.string().trim().max(2000).default(""),
});
export type ReportInput = z.input<typeof reportInput>;

async function normalize(tx: Tx, actor: Actor, driverId: string, raw: ReportInput) {
  const input = parse(reportInput, raw);
  if (toMin(input.endTime) <= toMin(input.startTime)) throw invalid("終了時刻は開始時刻より後にしてください（日をまたぐ稼働は日ごとに分けてください）");
  if (input.workDate > todayJst()) throw invalid("未来の日付の日報は提出できません");
  const [d] = await tx.select().from(driver).where(eq(driver.userId, driverId)).limit(1);
  const [p] = await tx.select().from(project).where(eq(project.id, input.projectId)).limit(1);
  if (!d || !p) throw notFound("案件が見つかりません");
  if (p.divisionId !== d.divisionId) throw invalid("所属事業部の案件を選んでください");
  if (actor.role !== "DRIVER" && !canAccessDivision(actor, p.divisionId)) throw forbidden();
  const rf = p.reportFields;
  const worked = toMin(input.endTime) - toMin(input.startTime);
  const breakMinutes = rf.breakTime ? input.breakMinutes : 0;
  if (breakMinutes >= worked) throw invalid("休憩が稼働時間以上になっています");
  if (rf.quantity && !input.quantity) throw invalid(`${rf.quantityUnit}数（実績数量）を入力してください`);
  // 確定スケジュールとの紐付け（同じ日・案件の確定済み割当）
  const [a] = await tx
    .select({ id: assignment.id })
    .from(assignment)
    .innerJoin(shiftSlot, eq(shiftSlot.id, assignment.slotId))
    .where(and(eq(assignment.driverId, driverId), eq(assignment.workDate, input.workDate), eq(shiftSlot.projectId, input.projectId), eq(assignment.status, "CONFIRMED")))
    .limit(1);
  return {
    workDate: input.workDate,
    projectId: input.projectId,
    startTime: input.startTime,
    endTime: input.endTime,
    breakMinutes,
    quantity: rf.quantity ? input.quantity! : null,
    distanceKm: rf.distance ? (input.distanceKm ?? null) : null,
    notes: input.notes,
    assignmentId: a?.id ?? null,
    divisionId: p.divisionId,
  };
}

export async function saveMyReport(db: DB, actor: Actor, id: string | null, raw: ReportInput, submit = false) {
  if (actor.role !== "DRIVER") throw forbidden();
  try {
    return await db.transaction(async (tx) => {
      const { divisionId, ...v } = await normalize(tx, actor, actor.userId, raw);
      let reportId = id;
      if (id) {
        const [r] = await tx.select().from(dailyReport).where(eq(dailyReport.id, id)).for("update");
        if (!r || r.driverId !== actor.userId) throw notFound("日報が見つかりません");
        if (r.status !== "DRAFT" && r.status !== "RETURNED") throw conflict("提出済み・承認済みの日報は編集できません");
        await tx.update(dailyReport).set({ ...v, ...(submit ? { status: "SUBMITTED", submittedAt: new Date(), returnReason: null } : {}) }).where(eq(dailyReport.id, id));
      } else {
        const [r] = await tx.insert(dailyReport).values({ ...v, driverId: actor.userId, status: submit ? "SUBMITTED" : "DRAFT", submittedAt: submit ? new Date() : null }).returning({ id: dailyReport.id });
        reportId = r.id;
      }
      await writeAudit(tx, actor, { action: submit ? "report.submit" : "report.save", entityType: "daily_report", entityId: reportId, divisionId, summary: `日報 ${v.workDate} を${submit ? "提出" : "保存"}` });
      return reportId!;
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw conflict("同じ時間帯の日報が既にあります");
    if (isUniqueViolation(e, "daily_report_driver_project_day_uq")) throw conflict("同じ日・同じ案件の日報が既にあります。その日報を開いて編集してください");
    throw e;
  }
}

export async function submitMyReport(db: DB, actor: Actor, id: string) {
  if (actor.role !== "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [r] = await tx.update(dailyReport).set({ status: "SUBMITTED", submittedAt: new Date(), returnReason: null }).where(and(eq(dailyReport.id, id), eq(dailyReport.driverId, actor.userId), inArray(dailyReport.status, ["DRAFT", "RETURNED"]))).returning();
    if (!r) throw conflict("提出できる日報がありません");
    await writeAudit(tx, actor, { action: "report.submit", entityType: "daily_report", entityId: id, summary: `日報 ${r.workDate} を提出` });
  });
}

async function lockForDecision(tx: Tx, actor: Actor, id: string) {
  const [r] = await tx.select({ r: dailyReport, divisionId: project.divisionId }).from(dailyReport).innerJoin(project, eq(project.id, dailyReport.projectId)).where(eq(dailyReport.id, id)).for("update", { of: dailyReport });
  if (!r || actor.role === "DRIVER" || !canAccessDivision(actor, r.divisionId)) throw notFound("日報が見つかりません");
  return r;
}

export async function approveReport(db: DB, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const r = await lockForDecision(tx, actor, id);
    if (r.r.status !== "SUBMITTED") throw conflict("この日報は既に処理されています");
    await tx.update(dailyReport).set({ status: "APPROVED", decidedById: actor.userId, decidedAt: new Date() }).where(and(eq(dailyReport.id, id), eq(dailyReport.status, "SUBMITTED")));
    await writeAudit(tx, actor, { action: "report.approve", entityType: "daily_report", entityId: id, divisionId: r.divisionId, summary: `日報 ${r.r.workDate} を承認` });
  });
}

export async function returnReport(db: DB, actor: Actor, id: string, reason: string) {
  const why = parse(zText("差戻し理由", 500), reason);
  await db.transaction(async (tx) => {
    const r = await lockForDecision(tx, actor, id);
    if (r.r.status !== "SUBMITTED") throw conflict("この日報は既に処理されています");
    await tx.update(dailyReport).set({ status: "RETURNED", decidedById: actor.userId, decidedAt: new Date(), returnReason: why }).where(eq(dailyReport.id, id));
    await writeAudit(tx, actor, { action: "report.return", entityType: "daily_report", entityId: id, divisionId: r.divisionId, summary: `日報 ${r.r.workDate} を差戻し: ${why}` });
  });
}

/** 承認後の訂正（会社側）。訂正前の内容を履歴に残す。確定済みの稼働明細に含まれる日報は訂正できない */
export async function correctApprovedReport(db: DB, actor: Actor, id: string, raw: ReportInput, reason: string) {
  const why = parse(zText("訂正理由", 500), reason);
  try {
    await db.transaction(async (tx) => {
      const r = await lockForDecision(tx, actor, id);
      if (r.r.status !== "APPROVED") throw conflict("承認済みの日報だけ訂正できます");
      if (r.r.statementId) {
        const [s] = await tx.select({ status: statement.status }).from(statement).where(eq(statement.id, r.r.statementId)).limit(1);
        if (s && s.status !== "DRAFT" && s.status !== "REVIEW") throw conflict("確定済みの稼働明細に含まれているため訂正できません。明細の訂正版を作成してから訂正してください");
      }
      const { divisionId, ...v } = await normalize(tx, actor, r.r.driverId, raw);
      await tx.insert(dailyReportRevision).values({ reportId: id, version: r.r.version, snapshot: r.r, reason: why, actorId: actor.userId });
      await tx.update(dailyReport).set({ ...v, version: r.r.version + 1 }).where(eq(dailyReport.id, id));
      await writeAudit(tx, actor, { action: "report.correct", entityType: "daily_report", entityId: id, divisionId, summary: `承認済み日報 ${r.r.workDate} を訂正（版 ${r.r.version}→${r.r.version + 1}）: ${why}`, changes: { before: { start: r.r.startTime, end: r.r.endTime, break: r.r.breakMinutes, quantity: r.r.quantity }, after: { start: v.startTime, end: v.endTime, break: v.breakMinutes, quantity: v.quantity } } });
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw conflict("同じ時間帯の日報が既にあります");
    throw e;
  }
}

/* ---------------- 閲覧 ---------------- */

export async function listReports(db: DB, actor: Actor, opts: { status?: string; month?: string; driverId?: string; divisionId?: string } = {}) {
  const scope = actor.role === "DRIVER" ? null : divisionScope(actor);
  return db
    .select({ r: dailyReport, driverName: appUser.name, projectCode: project.code, projectName: project.name, divisionId: project.divisionId, reportFields: project.reportFields, fileCount: sql<number>`(select count(*)::int from stored_file f where f.owner_type = 'DAILY_REPORT' and f.owner_id = ${dailyReport.id})` })
    .from(dailyReport)
    .innerJoin(project, eq(project.id, dailyReport.projectId))
    .innerJoin(appUser, eq(appUser.id, dailyReport.driverId))
    .where(
      and(
        actor.role === "DRIVER" ? eq(dailyReport.driverId, actor.userId) : undefined,
        scope ? (scope.length ? inArray(project.divisionId, scope) : sql`false`) : undefined,
        opts.status ? sql`${dailyReport.status} = ${opts.status}` : undefined,
        opts.month ? sql`to_char(${dailyReport.workDate}, 'YYYY-MM') = ${opts.month}` : undefined,
        opts.driverId ? eq(dailyReport.driverId, opts.driverId) : undefined,
        opts.divisionId ? eq(project.divisionId, opts.divisionId) : undefined,
      ),
    )
    .orderBy(desc(dailyReport.workDate), asc(appUser.name))
    .limit(300);
}

export async function getReport(db: DB, actor: Actor, id: string) {
  const [r] = await db
    .select({ r: dailyReport, driverName: appUser.name, projectCode: project.code, projectName: project.name, divisionId: project.divisionId, reportFields: project.reportFields })
    .from(dailyReport)
    .innerJoin(project, eq(project.id, dailyReport.projectId))
    .innerJoin(appUser, eq(appUser.id, dailyReport.driverId))
    .where(eq(dailyReport.id, id))
    .limit(1);
  if (!r || (actor.role === "DRIVER" ? r.r.driverId !== actor.userId : !canAccessDivision(actor, r.divisionId))) throw notFound("日報が見つかりません");
  const files = await db.select({ id: storedFile.id, name: storedFile.originalName, size: storedFile.size }).from(storedFile).where(and(eq(storedFile.ownerType, "DAILY_REPORT"), eq(storedFile.ownerId, id)));
  const revisions = await db.select().from(dailyReportRevision).where(eq(dailyReportRevision.reportId, id)).orderBy(desc(dailyReportRevision.version));
  return { ...r, files, revisions };
}

/** 未提出日（確定スケジュールがあるのに日報が提出されていない日） */
export async function missingReports(db: DB, actor: Actor, opts: { days?: number; driverId?: string } = {}) {
  const today = todayJst();
  const from = addDays(today, -(opts.days ?? 31));
  const scope = actor.role === "DRIVER" ? null : divisionScope(actor);
  return db
    .select({ assignmentId: assignment.id, workDate: assignment.workDate, start: assignment.startTime, end: assignment.endTime, driverId: assignment.driverId, driverName: appUser.name, projectId: project.id, projectCode: project.code, projectName: project.name })
    .from(assignment)
    .innerJoin(shiftSlot, eq(shiftSlot.id, assignment.slotId))
    .innerJoin(project, eq(project.id, shiftSlot.projectId))
    .innerJoin(appUser, eq(appUser.id, assignment.driverId))
    .where(
      and(
        eq(assignment.status, "CONFIRMED"),
        gte(assignment.workDate, from),
        lte(assignment.workDate, today),
        actor.role === "DRIVER" ? eq(assignment.driverId, actor.userId) : opts.driverId ? eq(assignment.driverId, opts.driverId) : undefined,
        scope ? (scope.length ? inArray(project.divisionId, scope) : sql`false`) : undefined,
        sql`not exists (select 1 from daily_report r where r.driver_id = ${assignment.driverId} and r.project_id = ${project.id} and r.work_date = ${assignment.workDate} and r.status <> 'DRAFT')`,
      ),
    )
    .orderBy(asc(assignment.workDate));
}

/* ---------------- 添付 ---------------- */

export async function addReportFile(db: DB, actor: Actor, reportId: string, file: { name: string; bytes: Uint8Array }) {
  const mime = validateFile(file.bytes);
  const key = await putObject("reports", file.bytes, mime);
  try {
    await db.transaction(async (tx) => {
      const [r] = await tx.select({ r: dailyReport, rf: project.reportFields }).from(dailyReport).innerJoin(project, eq(project.id, dailyReport.projectId)).where(eq(dailyReport.id, reportId)).for("update", { of: dailyReport });
      if (!r || r.r.driverId !== actor.userId) throw notFound("日報が見つかりません");
      if (!r.rf.attachments) throw invalid("この案件の日報には添付できません");
      if (r.r.status !== "DRAFT" && r.r.status !== "RETURNED") throw conflict("提出済みの日報には添付できません");
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(storedFile).where(and(eq(storedFile.ownerType, "DAILY_REPORT"), eq(storedFile.ownerId, reportId)));
      if (n >= 5) throw invalid("添付は5ファイルまでです");
      await tx.insert(storedFile).values({ storageKey: key, originalName: safeName(file.name), mimeType: mime, size: file.bytes.length, ownerType: "DAILY_REPORT", ownerId: reportId, uploadedById: actor.userId });
    });
  } catch (e) {
    await deleteObject(key);
    throw e;
  }
}

export async function pendingReportsForApprover(db: DB, actor: Actor) {
  if (actor.role === "DRIVER") return [];
  return (await listReports(db, actor, { status: "SUBMITTED" })).filter((r) => canAccessDivision(actor, r.divisionId));
}

