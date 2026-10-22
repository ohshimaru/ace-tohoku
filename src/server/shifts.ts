/**
 * 稼働スケジュール
 * - ドライバー: 稼働希望（可能 / 不可 / 時間指定）を下書き→提出。提出後の変更は変更申請
 * - 会社: 稼働枠（案件・日付・時間帯・必要人数・条件）を作成し、提出済みの希望から割当を自動作成（下書き）
 *         → 手動調整 → 確定。自動作成だけで確定・通知はしない
 *
 * 必須制約（自動・手動とも必ず守る。DBでも時間帯の重複を禁止）:
 *  ・稼働不可の日／希望の時間外に割り当てない ・同じドライバーの時間帯を重複させない
 *  ・必要資格・車両・エリアを満たす ・月の稼働日数上限、1日の稼働時間上限を守る
 * 優先条件（必須ではない）: 稼働日数の少ない人を優先（公平性）、希望案件を優先
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, assignment, assignmentHistory, availability, availabilityChangeRequest, availabilityPeriod, availabilitySubmission, division, driver, project, shiftSlot } from "@/db/schema";
import { type Actor, canAccessDivision, divisionScope } from "@/lib/access";
import { DATE_RE, monthRange, MONTH_RE, todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { parse, zDate, zText } from "./validate";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (t: string) => t.slice(0, 5);

function isExclusionViolation(e: unknown) {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur === "object" && cur && "code" in cur && (cur as { code: string }).code === "23P01") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/* ================================================================== */
/* 受付期間                                                             */
/* ================================================================== */

export async function openPeriod(db: DB, actor: Actor, raw: { month: string; deadline: string; divisionId?: string }) {
  if (actor.role === "DRIVER") throw forbidden();
  const month = parse(z.string().regex(MONTH_RE, "対象月を選んでください"), raw.month);
  if (!raw.deadline) throw invalid("締切を入力してください");
  const deadline = new Date(`${raw.deadline}:00+09:00`);
  if (Number.isNaN(deadline.getTime())) throw invalid("締切の日時が正しくありません");
  if (raw.divisionId && !canAccessDivision(actor, raw.divisionId)) throw forbidden();
  if (!raw.divisionId && divisionScope(actor)) throw invalid("事業部を選んでください");
  await db.transaction(async (tx) => {
    await tx
      .insert(availabilityPeriod)
      .values({ month, deadline, divisionId: raw.divisionId || null, status: "OPEN" })
      .onConflictDoUpdate({ target: availabilityPeriod.month, set: { deadline, status: "OPEN", divisionId: raw.divisionId || null } });
    await writeAudit(tx, actor, { action: "availability.period", entityType: "availability_period", entityId: month, divisionId: raw.divisionId || null, summary: `${month}の稼働希望の受付を開始（締切 ${raw.deadline}）` });
  });
}

export async function closePeriod(db: DB, actor: Actor, month: string) {
  if (actor.role === "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [p] = await tx.update(availabilityPeriod).set({ status: "CLOSED" }).where(eq(availabilityPeriod.month, month)).returning();
    if (!p) throw notFound();
    await writeAudit(tx, actor, { action: "availability.close", entityType: "availability_period", entityId: month, summary: `${month}の稼働希望の受付を終了` });
  });
}

/* ================================================================== */
/* ドライバー: 稼働希望                                                 */
/* ================================================================== */

const dayInput = z.object({
  date: z.string().regex(DATE_RE),
  kind: z.enum(["AVAILABLE", "UNAVAILABLE", "TIME", ""]),
  start: z.string().optional(),
  end: z.string().optional(),
});

export async function getMyAvailability(db: DB, actor: Actor, month: string) {
  if (actor.role !== "DRIVER") throw forbidden();
  const [from, to] = monthRange(month);
  const [period] = await db.select().from(availabilityPeriod).where(eq(availabilityPeriod.month, month)).limit(1);
  const [sub] = await db.select().from(availabilitySubmission).where(and(eq(availabilitySubmission.driverId, actor.userId), eq(availabilitySubmission.month, month))).limit(1);
  const days = await db.select().from(availability).where(and(eq(availability.driverId, actor.userId), gte(availability.workDate, from), lte(availability.workDate, to))).orderBy(asc(availability.workDate));
  const requests = await db.select().from(availabilityChangeRequest).where(and(eq(availabilityChangeRequest.driverId, actor.userId), gte(availabilityChangeRequest.workDate, from), lte(availabilityChangeRequest.workDate, to))).orderBy(desc(availabilityChangeRequest.createdAt));
  return { period: period ?? null, submitted: sub?.status === "SUBMITTED", submittedAt: sub?.submittedAt ?? null, days, requests };
}

/** 稼働希望の保存（下書き）。複数日まとめて保存できる。提出後は変更申請を使う */
export async function saveMyAvailability(db: DB, actor: Actor, month: string, rawDays: z.input<typeof dayInput>[]) {
  if (actor.role !== "DRIVER") throw forbidden();
  if (!MONTH_RE.test(month)) throw invalid("対象月が正しくありません");
  const [from, to] = monthRange(month);
  const days = rawDays.map((d) => parse(dayInput, d));
  for (const d of days) {
    if (d.date < from || d.date > to) throw invalid("対象月以外の日付が含まれています");
    if (d.kind === "TIME") {
      if (!d.start || !d.end || !TIME_RE.test(d.start) || !TIME_RE.test(d.end)) throw invalid(`${d.date} の時間を入力してください`);
      if (toMin(d.end) <= toMin(d.start)) throw invalid(`${d.date} の終了時刻は開始時刻より後にしてください`);
    }
  }
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(availabilityPeriod).where(eq(availabilityPeriod.month, month)).limit(1);
    if (!p || p.status !== "OPEN") throw invalid("この月の稼働希望は受け付けていません");
    const [sub] = await tx.select().from(availabilitySubmission).where(and(eq(availabilitySubmission.driverId, actor.userId), eq(availabilitySubmission.month, month))).for("update");
    if (sub?.status === "SUBMITTED") throw conflict("提出済みです。変更する場合は日ごとに変更申請をしてください");
    for (const d of days) {
      if (d.kind === "") {
        await tx.delete(availability).where(and(eq(availability.driverId, actor.userId), eq(availability.workDate, d.date)));
        continue;
      }
      const v = { kind: d.kind, startTime: d.kind === "TIME" ? d.start! : null, endTime: d.kind === "TIME" ? d.end! : null };
      await tx.insert(availability).values({ driverId: actor.userId, workDate: d.date, month, ...v }).onConflictDoUpdate({ target: [availability.driverId, availability.workDate], set: v });
    }
    if (!sub) await tx.insert(availabilitySubmission).values({ driverId: actor.userId, month, status: "DRAFT" });
  });
}

export async function submitMyAvailability(db: DB, actor: Actor, month: string) {
  if (actor.role !== "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(availabilityPeriod).where(eq(availabilityPeriod.month, month)).limit(1);
    if (!p || p.status !== "OPEN") throw invalid("この月の稼働希望は受け付けていません");
    const [from, to] = monthRange(month);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(availability).where(and(eq(availability.driverId, actor.userId), gte(availability.workDate, from), lte(availability.workDate, to)));
    if (n === 0) throw invalid("1日以上入力してから提出してください");
    const r = await tx
      .insert(availabilitySubmission)
      .values({ driverId: actor.userId, month, status: "SUBMITTED", submittedAt: new Date() })
      .onConflictDoUpdate({ target: [availabilitySubmission.driverId, availabilitySubmission.month], set: { status: "SUBMITTED", submittedAt: new Date() }, where: sql`${availabilitySubmission.status} <> 'SUBMITTED'` })
      .returning();
    if (!r.length) throw conflict("既に提出済みです");
    await writeAudit(tx, actor, { action: "availability.submit", entityType: "availability_submission", entityId: `${actor.userId}:${month}`, summary: `${month}の稼働希望を提出（${n}日分）${new Date() > p.deadline ? "【締切後】" : ""}` });
  });
}

export async function requestAvailabilityChange(db: DB, actor: Actor, raw: { date: string; kind: string; start?: string; end?: string; reason: string }) {
  if (actor.role !== "DRIVER") throw forbidden();
  const d = parse(dayInput, raw);
  if (d.kind === "") throw invalid("変更後の内容を選んでください");
  if (d.kind === "TIME" && (!d.start || !d.end || toMin(d.end) <= toMin(d.start))) throw invalid("時間を正しく入力してください");
  const reason = parse(zText("理由", 300), raw.reason);
  if (d.date < todayJst()) throw invalid("過去の日付は変更申請できません");
  await db.transaction(async (tx) => {
    await tx.insert(availabilityChangeRequest).values({ driverId: actor.userId, workDate: d.date, kind: d.kind as "AVAILABLE", startTime: d.kind === "TIME" ? d.start! : null, endTime: d.kind === "TIME" ? d.end! : null, reason });
    await writeAudit(tx, actor, { action: "availability.change_request", entityType: "availability", entityId: `${actor.userId}:${d.date}`, summary: `${d.date}の稼働希望の変更を申請: ${reason}` });
  });
}

export async function decideChangeRequest(db: DB, actor: Actor, id: string, approve: boolean) {
  if (actor.role === "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [r] = await tx.select({ r: availabilityChangeRequest, divisionId: driver.divisionId }).from(availabilityChangeRequest).innerJoin(driver, eq(driver.userId, availabilityChangeRequest.driverId)).where(eq(availabilityChangeRequest.id, id)).for("update");
    if (!r || !canAccessDivision(actor, r.divisionId)) throw notFound("変更申請が見つかりません");
    if (r.r.status !== "PENDING") throw conflict("この申請は既に処理されています");
    if (approve) {
      // 不可・時間変更で既存の割当と矛盾する場合は、先に割当を外す必要がある
      const conflicts = await tx.select().from(assignment).where(and(eq(assignment.driverId, r.r.driverId), eq(assignment.workDate, r.r.workDate), ne(assignment.status, "CANCELED")));
      for (const a of conflicts) {
        const ok = r.r.kind === "AVAILABLE" || (r.r.kind === "TIME" && toMin(hhmm(a.startTime)) >= toMin(hhmm(r.r.startTime!)) && toMin(hhmm(a.endTime)) <= toMin(hhmm(r.r.endTime!)));
        if (!ok) throw conflict("この日は既に割当があり、変更後の内容と矛盾します。先に割当を外してから承認してください");
      }
      const v = { kind: r.r.kind, startTime: r.r.startTime, endTime: r.r.endTime };
      await tx.insert(availability).values({ driverId: r.r.driverId, workDate: r.r.workDate, month: r.r.workDate.slice(0, 7), ...v }).onConflictDoUpdate({ target: [availability.driverId, availability.workDate], set: v });
    }
    await tx.update(availabilityChangeRequest).set({ status: approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date() }).where(eq(availabilityChangeRequest.id, id));
    await writeAudit(tx, actor, { action: approve ? "availability.change_approve" : "availability.change_reject", entityType: "availability", entityId: `${r.r.driverId}:${r.r.workDate}`, divisionId: r.divisionId, summary: `稼働希望の変更申請（${r.r.workDate}）を${approve ? "承認" : "却下"}` });
  });
}

/* ================================================================== */
/* 会社: 稼働枠                                                         */
/* ================================================================== */

const slotInput = z.object({
  projectId: z.string().uuid("案件を選んでください"),
  dates: z.array(zDate("日付")).min(1, "日付を1日以上選んでください").max(62),
  startTime: z.string().regex(TIME_RE, "開始時刻を入力してください"),
  endTime: z.string().regex(TIME_RE, "終了時刻を入力してください"),
  requiredCount: z.coerce.number().int().min(1, "必要人数は1人以上").max(100),
  requiredQualifications: z.string().default(""),
  requiredVehicle: z.string().trim().max(50).default(""),
  area: z.string().trim().max(50).default(""),
  note: z.string().trim().max(300).default(""),
});

async function projectDivision(tx: Tx, actor: Actor, projectId: string) {
  const [p] = await tx.select({ divisionId: project.divisionId, code: project.code }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!p || !canAccessDivision(actor, p.divisionId)) throw notFound("案件が見つかりません");
  return p;
}

/** 稼働枠を作成（複数日まとめて） */
export async function createSlots(db: DB, actor: Actor, raw: z.input<typeof slotInput>) {
  if (actor.role === "DRIVER") throw forbidden();
  const input = parse(slotInput, raw);
  if (toMin(input.endTime) <= toMin(input.startTime)) throw invalid("終了時刻は開始時刻より後にしてください（日をまたぐ稼働は2つの枠に分けてください）");
  return db.transaction(async (tx) => {
    const p = await projectDivision(tx, actor, input.projectId);
    const quals = input.requiredQualifications.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean);
    const rows = await tx
      .insert(shiftSlot)
      .values(Array.from(new Set(input.dates)).map((d) => ({ projectId: input.projectId, workDate: d, startTime: input.startTime, endTime: input.endTime, requiredCount: input.requiredCount, requiredQualifications: quals, requiredVehicle: input.requiredVehicle || null, area: input.area || null, note: input.note || null })))
      .returning({ id: shiftSlot.id });
    await writeAudit(tx, actor, { action: "slot.create", entityType: "shift_slot", divisionId: p.divisionId, summary: `${p.code} の稼働枠を${rows.length}日分作成（${input.startTime}〜${input.endTime}・${input.requiredCount}人）` });
    return rows.length;
  });
}

export async function cancelSlot(db: DB, actor: Actor, slotId: string) {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(shiftSlot).where(eq(shiftSlot.id, slotId)).for("update");
    if (!s) throw notFound();
    const p = await projectDivision(tx, actor, s.projectId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assignment).where(and(eq(assignment.slotId, slotId), eq(assignment.status, "CONFIRMED")));
    if (n > 0) throw conflict("確定済みの割当がある枠は取消できません。先に割当を外してください");
    await tx.update(assignment).set({ status: "CANCELED" }).where(and(eq(assignment.slotId, slotId), eq(assignment.status, "DRAFT")));
    await tx.update(shiftSlot).set({ status: "CANCELED" }).where(eq(shiftSlot.id, slotId));
    await writeAudit(tx, actor, { action: "slot.cancel", entityType: "shift_slot", entityId: slotId, divisionId: p.divisionId, summary: `${p.code} ${s.workDate} の稼働枠を取消` });
  });
}

/* ================================================================== */
/* 制約チェック                                                         */
/* ================================================================== */

type Slot = typeof shiftSlot.$inferSelect;
type DriverRow = typeof driver.$inferSelect & { name: string; status: string };

export type Violation = "UNAVAILABLE" | "NO_AVAILABILITY" | "OUTSIDE_TIME" | "OVERLAP" | "QUALIFICATION" | "VEHICLE" | "AREA" | "MONTH_CAP" | "DAY_CAP" | "INACTIVE" | "DIVISION";

export const VIOLATION_LABEL: Record<Violation, string> = {
  UNAVAILABLE: "稼働不可の日",
  NO_AVAILABILITY: "稼働希望が未提出・未入力",
  OUTSIDE_TIME: "希望の時間外",
  OVERLAP: "他の割当と時間が重複",
  QUALIFICATION: "必要な資格がない",
  VEHICLE: "必要な車両がない",
  AREA: "対応エリア外",
  MONTH_CAP: "月の稼働日数の上限",
  DAY_CAP: "1日の稼働時間の上限",
  INACTIVE: "利用停止中・未承認",
  DIVISION: "所属事業部が違う",
};

type Ctx = {
  avail: Map<string, typeof availability.$inferSelect>; // `${driver}|${date}`
  submitted: Set<string>; // `${driver}|${month}`
  busy: Map<string, { start: number; end: number }[]>; // `${driver}|${date}`
  days: Map<string, Set<string>>; // `${driver}|${month}` -> dates
};

async function loadCtx(tx: Tx, driverIds: string[], from: string, to: string): Promise<Ctx> {
  const ctx: Ctx = { avail: new Map(), submitted: new Set(), busy: new Map(), days: new Map() };
  if (!driverIds.length) return ctx;
  for (const a of await tx.select().from(availability).where(and(inArray(availability.driverId, driverIds), gte(availability.workDate, from), lte(availability.workDate, to)))) ctx.avail.set(`${a.driverId}|${a.workDate}`, a);
  for (const s of await tx.select().from(availabilitySubmission).where(and(inArray(availabilitySubmission.driverId, driverIds), eq(availabilitySubmission.status, "SUBMITTED")))) ctx.submitted.add(`${s.driverId}|${s.month}`);
  const asg = await tx.select().from(assignment).where(and(inArray(assignment.driverId, driverIds), ne(assignment.status, "CANCELED"), gte(assignment.workDate, from.slice(0, 7) + "-01"), lte(assignment.workDate, monthRange(to.slice(0, 7))[1])));
  for (const a of asg) addBusy(ctx, a.driverId, a.workDate, hhmm(a.startTime), hhmm(a.endTime));
  return ctx;
}

function addBusy(ctx: Ctx, driverId: string, date: string, start: string, end: string) {
  const k = `${driverId}|${date}`;
  ctx.busy.set(k, [...(ctx.busy.get(k) ?? []), { start: toMin(start), end: toMin(end) }]);
  const mk = `${driverId}|${date.slice(0, 7)}`;
  ctx.days.set(mk, new Set([...(ctx.days.get(mk) ?? []), date]));
}

export function checkConstraints(ctx: Ctx, d: DriverRow, slot: Slot, slotDivisionId: string): Violation[] {
  const v: Violation[] = [];
  const s = toMin(hhmm(slot.startTime));
  const e = toMin(hhmm(slot.endTime));
  if (d.status !== "ACTIVE") v.push("INACTIVE");
  if (d.divisionId !== slotDivisionId) v.push("DIVISION");
  const a = ctx.avail.get(`${d.userId}|${slot.workDate}`);
  if (!a || !ctx.submitted.has(`${d.userId}|${slot.workDate.slice(0, 7)}`)) v.push("NO_AVAILABILITY");
  else if (a.kind === "UNAVAILABLE") v.push("UNAVAILABLE");
  else if (a.kind === "TIME" && (s < toMin(hhmm(a.startTime!)) || e > toMin(hhmm(a.endTime!)))) v.push("OUTSIDE_TIME");
  const busy = ctx.busy.get(`${d.userId}|${slot.workDate}`) ?? [];
  if (busy.some((b) => b.start < e && s < b.end)) v.push("OVERLAP");
  for (const q of slot.requiredQualifications) if (!d.qualifications.includes(q)) v.push("QUALIFICATION");
  if (slot.requiredVehicle && !d.vehicles.includes(slot.requiredVehicle)) v.push("VEHICLE");
  if (slot.area && d.areas.length && !d.areas.includes(slot.area)) v.push("AREA");
  const days = ctx.days.get(`${d.userId}|${slot.workDate.slice(0, 7)}`) ?? new Set();
  if (d.maxDaysPerMonth && !days.has(slot.workDate) && days.size >= d.maxDaysPerMonth) v.push("MONTH_CAP");
  if (d.maxMinutesPerDay && busy.reduce((t, b) => t + b.end - b.start, 0) + (e - s) > d.maxMinutesPerDay) v.push("DAY_CAP");
  return Array.from(new Set(v));
}

async function driversOf(tx: Tx, divisionId: string): Promise<DriverRow[]> {
  return (await tx.select({ d: driver, name: appUser.name, status: appUser.status }).from(driver).innerJoin(appUser, eq(appUser.id, driver.userId)).where(eq(driver.divisionId, divisionId))).map((r) => ({ ...r.d, name: r.name, status: r.status }));
}

/* ================================================================== */
/* 自動割当（下書きを作るだけ。確定・通知はしない）                       */
/* ================================================================== */

export type Unfilled = { slotId: string; workDate: string; projectCode: string; time: string; missing: number; reasons: { label: string; count: number }[] };

export async function autoAssign(db: DB, actor: Actor, raw: { month: string; divisionId: string }) {
  if (actor.role === "DRIVER") throw forbidden();
  const month = parse(z.string().regex(MONTH_RE), raw.month);
  if (!canAccessDivision(actor, raw.divisionId)) throw forbidden();
  const [from, to] = monthRange(month);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assign:${raw.divisionId}:${month}`}))`);
    const slots = (await tx
      .select({ s: shiftSlot, code: project.code })
      .from(shiftSlot)
      .innerJoin(project, eq(project.id, shiftSlot.projectId))
      .where(and(eq(project.divisionId, raw.divisionId), eq(shiftSlot.status, "OPEN"), gte(shiftSlot.workDate, from), lte(shiftSlot.workDate, to)))
      .orderBy(asc(shiftSlot.workDate), asc(shiftSlot.startTime)));
    const drivers = await driversOf(tx, raw.divisionId);
    const ctx = await loadCtx(tx, drivers.map((d) => d.userId), from, to);
    const counts = await tx.select({ slotId: assignment.slotId, n: sql<number>`count(*)::int` }).from(assignment).where(and(inArray(assignment.slotId, slots.map((x) => x.s.id).concat(["00000000-0000-0000-0000-000000000000"])), ne(assignment.status, "CANCELED"))).groupBy(assignment.slotId);
    const assignedPerSlot = new Map(counts.map((c) => [c.slotId, c.n]));
    const already = await tx.select({ slotId: assignment.slotId, driverId: assignment.driverId }).from(assignment).where(and(inArray(assignment.slotId, slots.map((x) => x.s.id).concat(["00000000-0000-0000-0000-000000000000"])), ne(assignment.status, "CANCELED")));
    const inSlot = new Set(already.map((a) => `${a.slotId}|${a.driverId}`));
    let created = 0;
    const unfilled: Unfilled[] = [];
    for (const { s, code } of slots) {
      let need = s.requiredCount - (assignedPerSlot.get(s.id) ?? 0);
      if (need <= 0) continue;
      const reasons = new Map<Violation, number>();
      const ok: DriverRow[] = [];
      for (const d of drivers) {
        if (inSlot.has(`${s.id}|${d.userId}`)) continue;
        const v = checkConstraints(ctx, d, s, raw.divisionId);
        if (v.length === 0) ok.push(d);
        else for (const x of v) reasons.set(x, (reasons.get(x) ?? 0) + 1);
      }
      // 優先条件: 希望案件 → 当月の稼働日数が少ない → 名前順（安定）
      ok.sort((a, b) => {
        const pa = a.preferredProjectIds.includes(s.projectId) ? 0 : 1;
        const pb = b.preferredProjectIds.includes(s.projectId) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const da = ctx.days.get(`${a.userId}|${month}`)?.size ?? 0;
        const dbb = ctx.days.get(`${b.userId}|${month}`)?.size ?? 0;
        return da - dbb || a.name.localeCompare(b.name, "ja");
      });
      for (const d of ok) {
        if (need <= 0) break;
        // 直前の割当で状況が変わるため再確認
        if (checkConstraints(ctx, d, s, raw.divisionId).length) continue;
        const [a] = await tx.insert(assignment).values({ slotId: s.id, driverId: d.userId, workDate: s.workDate, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime), status: "DRAFT", source: "AUTO" }).returning({ id: assignment.id });
        await tx.insert(assignmentHistory).values({ assignmentId: a.id, action: "AUTO_CREATE", actorId: actor.userId, detail: { driver: d.name, date: s.workDate } });
        addBusy(ctx, d.userId, s.workDate, hhmm(s.startTime), hhmm(s.endTime));
        inSlot.add(`${s.id}|${d.userId}`);
        need--;
        created++;
      }
      if (need > 0) {
        unfilled.push({
          slotId: s.id,
          workDate: s.workDate,
          projectCode: code,
          time: `${hhmm(s.startTime)}〜${hhmm(s.endTime)}`,
          missing: need,
          reasons: drivers.length === 0 ? [{ label: "事業部にドライバーがいません", count: 0 }] : [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: VIOLATION_LABEL[k], count: n })),
        });
      }
    }
    await writeAudit(tx, actor, { action: "assignment.auto", entityType: "assignment", divisionId: raw.divisionId, summary: `${month}の割当を自動作成（下書き ${created}件・不足 ${unfilled.reduce((t, u) => t + u.missing, 0)}人）` });
    return { created, unfilled };
  });
}

/** 不足している枠ごとの理由と、割当可能な候補者（画面表示用。何も変更しない） */
export async function explainSlots(db: DB, actor: Actor, month: string, divisionId: string) {
  if (actor.role === "DRIVER" || !canAccessDivision(actor, divisionId)) throw forbidden();
  const [from, to] = monthRange(month);
  return db.transaction(async (tx) => {
    const slots = await tx.select({ s: shiftSlot }).from(shiftSlot).innerJoin(project, eq(project.id, shiftSlot.projectId)).where(and(eq(project.divisionId, divisionId), eq(shiftSlot.status, "OPEN"), gte(shiftSlot.workDate, from), lte(shiftSlot.workDate, to)));
    const drivers = await driversOf(tx, divisionId);
    const ctx = await loadCtx(tx, drivers.map((d) => d.userId), from, to);
    const asg = await tx.select({ slotId: assignment.slotId, driverId: assignment.driverId }).from(assignment).where(and(inArray(assignment.slotId, slots.map((x) => x.s.id).concat(["00000000-0000-0000-0000-000000000000"])), ne(assignment.status, "CANCELED")));
    const out = new Map<string, { candidates: { id: string; name: string }[]; reasons: { label: string; count: number }[] }>();
    for (const { s } of slots) {
      const inSlot = new Set(asg.filter((a) => a.slotId === s.id).map((a) => a.driverId));
      const reasons = new Map<Violation, number>();
      const candidates: { id: string; name: string }[] = [];
      for (const d of drivers) {
        if (inSlot.has(d.userId)) continue;
        const v = checkConstraints(ctx, d, s, divisionId);
        if (!v.length) candidates.push({ id: d.userId, name: d.name });
        else for (const x of v) reasons.set(x, (reasons.get(x) ?? 0) + 1);
      }
      out.set(s.id, { candidates, reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: VIOLATION_LABEL[k], count: n })) });
    }
    return out;
  });
}

/** 手動で割当（必須制約は手動でも守る） */
export async function assignManually(db: DB, actor: Actor, slotId: string, driverId: string) {
  if (actor.role === "DRIVER") throw forbidden();
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx.select().from(shiftSlot).where(eq(shiftSlot.id, slotId)).for("update");
      if (!s || s.status !== "OPEN") throw notFound("稼働枠が見つかりません");
      const p = await projectDivision(tx, actor, s.projectId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`driver-day:${driverId}:${s.workDate}`}))`);
      const [d] = (await driversOf(tx, p.divisionId)).filter((x) => x.userId === driverId);
      if (!d) throw invalid("この事業部のドライバーではありません");
      const ctx = await loadCtx(tx, [driverId], s.workDate, s.workDate);
      const v = checkConstraints(ctx, d, s, p.divisionId);
      if (v.length) throw invalid(`割り当てできません: ${v.map((x) => VIOLATION_LABEL[x]).join("、")}`);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assignment).where(and(eq(assignment.slotId, slotId), ne(assignment.status, "CANCELED")));
      if (n >= s.requiredCount) throw conflict("必要人数に達しています");
      const [a] = await tx.insert(assignment).values({ slotId, driverId, workDate: s.workDate, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime), status: "DRAFT", source: "MANUAL" }).returning({ id: assignment.id });
      await tx.insert(assignmentHistory).values({ assignmentId: a.id, action: "MANUAL_CREATE", actorId: actor.userId, detail: { driver: d.name, date: s.workDate } });
      await writeAudit(tx, actor, { action: "assignment.create", entityType: "assignment", entityId: a.id, divisionId: p.divisionId, summary: `${d.name} を ${p.code} ${s.workDate} に割当（下書き）` });
      return a.id;
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw conflict("このドライバーは同じ時間帯に別の割当があります");
    if (isUniqueViolation(e)) throw conflict("既にこの枠に割り当てられています");
    throw e;
  }
}

export async function unassign(db: DB, actor: Actor, assignmentId: string, reason: string) {
  if (actor.role === "DRIVER") throw forbidden();
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(assignment).where(eq(assignment.id, assignmentId)).for("update");
    if (!a || a.status === "CANCELED") throw notFound("割当が見つかりません");
    const [s] = await tx.select().from(shiftSlot).where(eq(shiftSlot.id, a.slotId)).limit(1);
    const p = await projectDivision(tx, actor, s.projectId);
    if (a.status === "CONFIRMED" && !reason.trim()) throw invalid("確定済みの割当を外す場合は理由を入力してください");
    await tx.update(assignment).set({ status: "CANCELED" }).where(eq(assignment.id, assignmentId));
    await tx.insert(assignmentHistory).values({ assignmentId, action: a.status === "CONFIRMED" ? "CANCEL_CONFIRMED" : "REMOVE_DRAFT", actorId: actor.userId, detail: { reason } });
    await writeAudit(tx, actor, { action: "assignment.cancel", entityType: "assignment", entityId: assignmentId, divisionId: p.divisionId, summary: `${p.code} ${a.workDate} の割当を外す${reason ? `: ${reason}` : ""}` });
  });
}

/** 下書きの割当を確定（会社側が確認してから） */
export async function confirmAssignments(db: DB, actor: Actor, raw: { month: string; divisionId: string }) {
  if (actor.role === "DRIVER") throw forbidden();
  if (!canAccessDivision(actor, raw.divisionId)) throw forbidden();
  const [from, to] = monthRange(parse(z.string().regex(MONTH_RE), raw.month));
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(assignment)
      .set({ status: "CONFIRMED", confirmedAt: new Date(), confirmedById: actor.userId })
      .where(and(eq(assignment.status, "DRAFT"), gte(assignment.workDate, from), lte(assignment.workDate, to), sql`${assignment.slotId} in (select s.id from shift_slot s join project p on p.id = s.project_id where p.division_id = ${raw.divisionId})`))
      .returning({ id: assignment.id });
    if (rows.length) await tx.insert(assignmentHistory).values(rows.map((r) => ({ assignmentId: r.id, action: "CONFIRM", actorId: actor.userId })));
    await writeAudit(tx, actor, { action: "assignment.confirm", entityType: "assignment", divisionId: raw.divisionId, summary: `${raw.month}の割当 ${rows.length}件を確定` });
    return rows.length;
  });
}

/* ================================================================== */
/* 閲覧                                                                 */
/* ================================================================== */

export async function getBoard(db: DB, actor: Actor, month: string, divisionId: string) {
  if (actor.role === "DRIVER" || !canAccessDivision(actor, divisionId)) throw forbidden();
  const [from, to] = monthRange(month);
  const slots = await db
    .select({ s: shiftSlot, code: project.code, projectName: project.name })
    .from(shiftSlot)
    .innerJoin(project, eq(project.id, shiftSlot.projectId))
    .where(and(eq(project.divisionId, divisionId), gte(shiftSlot.workDate, from), lte(shiftSlot.workDate, to), eq(shiftSlot.status, "OPEN")))
    .orderBy(asc(shiftSlot.workDate), asc(shiftSlot.startTime), asc(project.code));
  const asg = await db
    .select({ a: assignment, name: appUser.name })
    .from(assignment)
    .innerJoin(appUser, eq(appUser.id, assignment.driverId))
    .where(and(gte(assignment.workDate, from), lte(assignment.workDate, to), ne(assignment.status, "CANCELED"), inArray(assignment.slotId, slots.map((x) => x.s.id).concat(["00000000-0000-0000-0000-000000000000"]))));
  const drivers = await driversOf(db, divisionId);
  const subs = await db.select().from(availabilitySubmission).where(and(eq(availabilitySubmission.month, month), inArray(availabilitySubmission.driverId, drivers.map((d) => d.userId).concat(["00000000-0000-0000-0000-000000000000"]))));
  const [period] = await db.select().from(availabilityPeriod).where(eq(availabilityPeriod.month, month)).limit(1);
  const changeRequests = await db
    .select({ r: availabilityChangeRequest, name: appUser.name })
    .from(availabilityChangeRequest)
    .innerJoin(appUser, eq(appUser.id, availabilityChangeRequest.driverId))
    .innerJoin(driver, eq(driver.userId, availabilityChangeRequest.driverId))
    .where(and(eq(availabilityChangeRequest.status, "PENDING"), eq(driver.divisionId, divisionId)))
    .orderBy(asc(availabilityChangeRequest.workDate));
  return {
    period: period ?? null,
    slots: slots.map((x) => ({ ...x, assignments: asg.filter((a) => a.a.slotId === x.s.id) })),
    drivers: drivers.map((d) => ({ ...d, submission: subs.find((s) => s.driverId === d.userId)?.status ?? "NONE", days: new Set(asg.filter((a) => a.a.driverId === d.userId).map((a) => a.a.workDate)).size })),
    changeRequests,
  };
}

/** スケジュール一覧（Excel 出力用）。ドライバー本人は自分の確定分のみ */
export async function scheduleRows(db: DB, actor: Actor, opts: { month: string; divisionId?: string; projectId?: string; driverId?: string; confirmedOnly?: boolean }) {
  const [from, to] = monthRange(parse(z.string().regex(MONTH_RE), opts.month));
  const scope = divisionScope(actor);
  const isDriver = actor.role === "DRIVER";
  if (opts.divisionId && !isDriver && !canAccessDivision(actor, opts.divisionId)) throw forbidden();
  return db
    .select({ date: assignment.workDate, start: assignment.startTime, end: assignment.endTime, status: assignment.status, driverName: appUser.name, driverId: assignment.driverId, projectCode: project.code, projectName: project.name, divisionName: division.name, area: shiftSlot.area })
    .from(assignment)
    .innerJoin(shiftSlot, eq(shiftSlot.id, assignment.slotId))
    .innerJoin(project, eq(project.id, shiftSlot.projectId))
    .innerJoin(division, eq(division.id, project.divisionId))
    .innerJoin(appUser, eq(appUser.id, assignment.driverId))
    .where(
      and(
        gte(assignment.workDate, from),
        lte(assignment.workDate, to),
        isDriver || opts.confirmedOnly ? eq(assignment.status, "CONFIRMED") : ne(assignment.status, "CANCELED"),
        isDriver ? eq(assignment.driverId, actor.userId) : opts.driverId ? eq(assignment.driverId, opts.driverId) : undefined,
        !isDriver && scope ? (scope.length ? inArray(project.divisionId, scope) : sql`false`) : undefined,
        opts.divisionId ? eq(project.divisionId, opts.divisionId) : undefined,
        opts.projectId ? eq(project.id, opts.projectId) : undefined,
      ),
    )
    .orderBy(asc(assignment.workDate), asc(assignment.startTime), asc(appUser.name));
}

export async function myUpcoming(db: DB, actor: Actor, from: string, to: string) {
  return db
    .select({ id: assignment.id, date: assignment.workDate, start: assignment.startTime, end: assignment.endTime, projectId: project.id, projectCode: project.code, projectName: project.name, area: shiftSlot.area, note: shiftSlot.note })
    .from(assignment)
    .innerJoin(shiftSlot, eq(shiftSlot.id, assignment.slotId))
    .innerJoin(project, eq(project.id, shiftSlot.projectId))
    .where(and(eq(assignment.driverId, actor.userId), eq(assignment.status, "CONFIRMED"), gte(assignment.workDate, from), lte(assignment.workDate, to)))
    .orderBy(asc(assignment.workDate), asc(assignment.startTime));
}
