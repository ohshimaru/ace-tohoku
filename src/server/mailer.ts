/**
 * メール送信キューとリマインド
 * - 送信は email_outbox 経由。dedupe_key が同じメールは1通しか作られない（重複送信防止）
 * - 送信処理は行ロック（SKIP LOCKED）で取り出すため、同時に動いても同じメールを2回送らない
 * - 失敗は 5分→15分→60分 で再試行し、4回失敗したら「失敗」。画面から再試行できる
 * - 稼働希望のリマインドは「未提出者だけ」。送信直前にも提出状況を確認し、提出済みなら送らない
 */
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { appUser, availabilityPeriod, availabilitySubmission, driver, emailOutbox, reminderRule } from "@/db/schema";
import { emailDriver, PermanentEmailError, sendMail } from "@/adapters/email";
import { type Actor, divisionScope, isStaff } from "@/lib/access";
import { addDays, formatDateTime, toJstDate } from "@/lib/dates";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";

const BACKOFF_MIN = [5, 15, 60];
const MAX_ATTEMPTS = 4;

export async function enqueueEmail(
  tx: Tx,
  m: { dedupeKey: string; kind: string; toUserId?: string | null; toEmail: string; subject: string; body: string; context?: Record<string, string>; sendAt?: Date },
) {
  const r = await tx
    .insert(emailOutbox)
    .values({ dedupeKey: m.dedupeKey, kind: m.kind, toUserId: m.toUserId ?? null, toEmail: m.toEmail, subject: m.subject, body: m.body, context: m.context ?? {}, nextAttemptAt: m.sendAt ?? new Date() })
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    .returning({ id: emailOutbox.id });
  return r.length > 0;
}

/** 送信直前の確認: まだ送る必要があるか */
async function stillNeeded(db: Tx, m: typeof emailOutbox.$inferSelect): Promise<string | null> {
  if (m.kind === "AVAILABILITY_REMINDER" && m.context.month && m.toUserId) {
    const [s] = await db.select().from(availabilitySubmission).where(and(eq(availabilitySubmission.driverId, m.toUserId), eq(availabilitySubmission.month, m.context.month))).limit(1);
    if (s?.status === "SUBMITTED") return "提出済みのため送信しませんでした";
    const [p] = await db.select().from(availabilityPeriod).where(eq(availabilityPeriod.month, m.context.month)).limit(1);
    if (!p || p.status !== "OPEN") return "受付が終了したため送信しませんでした";
    const [u] = await db.select({ status: appUser.status, email: appUser.email, verified: appUser.emailVerifiedAt }).from(appUser).where(eq(appUser.id, m.toUserId)).limit(1);
    if (!u || u.status !== "ACTIVE") return "利用停止中のため送信しませんでした";
    if (!u.verified || u.email?.toLowerCase() !== m.toEmail.toLowerCase()) return "メールアドレスが変更・未確認のため送信しませんでした";
  }
  return null;
}

/** 送信待ちのメールを処理する（定期処理から呼ぶ） */
export async function processOutbox(db: DB, now = new Date(), limit = 50) {
  let sent = 0, failed = 0, skipped = 0, retried = 0;
  for (let i = 0; i < limit; i++) {
    const done = await db.transaction(async (tx) => {
      const [m] = await tx
        .select()
        .from(emailOutbox)
        .where(and(eq(emailOutbox.status, "QUEUED"), lte(emailOutbox.nextAttemptAt, now)))
        .orderBy(asc(emailOutbox.nextAttemptAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!m) return false;
      const skip = await stillNeeded(tx, m);
      if (skip) {
        await tx.update(emailOutbox).set({ status: "SKIPPED", lastError: skip }).where(eq(emailOutbox.id, m.id));
        skipped++;
        return true;
      }
      try {
        const r = await sendMail({ to: m.toEmail, subject: m.subject, text: m.body });
        await tx.update(emailOutbox).set({ status: "SENT", sentAt: now, attempts: m.attempts + 1, driver: r.driver, lastError: null }).where(eq(emailOutbox.id, m.id));
        sent++;
      } catch (e) {
        const attempts = m.attempts + 1;
        const permanent = e instanceof PermanentEmailError || attempts >= MAX_ATTEMPTS;
        const msg = (e instanceof Error ? e.message : "送信エラー").slice(0, 300);
        await tx
          .update(emailOutbox)
          .set({ attempts, lastError: msg, driver: emailDriver(), status: permanent ? "FAILED" : "QUEUED", nextAttemptAt: new Date(now.getTime() + (BACKOFF_MIN[attempts - 1] ?? 60) * 60_000) })
          .where(eq(emailOutbox.id, m.id));
        if (permanent) failed++;
        else retried++;
      }
      return true;
    });
    if (!done) break;
  }
  return { sent, failed, skipped, retried };
}

/**
 * 稼働希望のリマインドを予約（締切からの相対日数のルールに従う）
 * 未提出・利用中・メール確認済みのドライバーだけが対象。同じ月×人×タイミングは1通だけ。
 */
export async function scheduleAvailabilityReminders(db: DB, now = new Date()) {
  const rules = await db.select().from(reminderRule).where(and(eq(reminderRule.kind, "AVAILABILITY"), eq(reminderRule.enabled, true)));
  const periods = await db.select().from(availabilityPeriod).where(eq(availabilityPeriod.status, "OPEN"));
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  let queued = 0;
  for (const p of periods) {
    const deadlineDay = toJstDate(p.deadline);
    for (const r of rules) {
      const sendDay = addDays(deadlineDay, r.offsetDays);
      const sendAt = new Date(`${sendDay}T${String(r.hour).padStart(2, "0")}:00:00+09:00`);
      // 送信予定時刻を過ぎてから24時間以内のものだけ予約（停止明けの大量送信を防ぐ）
      if (sendAt > now || now.getTime() - sendAt.getTime() > 24 * 3600_000) continue;
      const targets = await db
        .select({ id: appUser.id, name: appUser.name, email: appUser.email })
        .from(appUser)
        .innerJoin(driver, eq(driver.userId, appUser.id))
        .where(
          and(
            eq(appUser.status, "ACTIVE"),
            isNotNull(appUser.emailVerifiedAt),
            isNotNull(appUser.email),
            p.divisionId ? eq(driver.divisionId, p.divisionId) : undefined,
            sql`not exists (select 1 from availability_submission s where s.driver_id = ${appUser.id} and s.month = ${p.month} and s.status = 'SUBMITTED')`,
          ),
        );
      for (const t of targets) {
        const ok = await db.transaction((tx) =>
          enqueueEmail(tx, {
            dedupeKey: `avail:${p.month}:${t.id}:${r.offsetDays}`,
            kind: "AVAILABILITY_REMINDER",
            toUserId: t.id,
            toEmail: t.email!,
            subject: `【${p.month.replace("-", "年")}月分】稼働希望の提出をお願いします`,
            body: `${t.name} 様\n\n${p.month.replace("-", "年")}月分の稼働希望がまだ提出されていません。\n締切: ${formatDateTime(p.deadline)}\n\n提出はこちら（LINEでログイン）:\n${base}/d/availability?month=${p.month}\n\n提出済みの場合、このメールは届きません。`,
            context: { month: p.month },
            sendAt,
          }),
        );
        if (ok) queued++;
      }
    }
  }
  return { queued };
}

/* ---------------- 管理画面 ---------------- */

export async function listOutbox(db: DB, actor: Actor, opts: { status?: string } = {}) {
  if (!isStaff(actor)) throw forbidden();
  const scope = divisionScope(actor);
  return db
    .select({ m: emailOutbox, toName: appUser.name })
    .from(emailOutbox)
    .leftJoin(appUser, eq(appUser.id, emailOutbox.toUserId))
    .leftJoin(driver, eq(driver.userId, emailOutbox.toUserId))
    .where(and(opts.status ? sql`${emailOutbox.status} = ${opts.status}` : undefined, scope ? (scope.length ? inArray(driver.divisionId, scope) : sql`false`) : undefined))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(200);
}

/** 失敗したメールの再試行（同じメールを新しく作らず、同じ行を送信待ちに戻す） */
export async function retryEmail(db: DB, actor: Actor, id: string) {
  if (!isStaff(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id)).for("update");
    if (!m) throw notFound("メールが見つかりません");
    if (m.status !== "FAILED") throw conflict("失敗したメールだけ再試行できます");
    await tx.update(emailOutbox).set({ status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(eq(emailOutbox.id, id));
    await writeAudit(tx, actor, { action: "email.retry", entityType: "email_outbox", entityId: id, summary: `メール「${m.subject}」を再試行` });
  });
}

export async function listReminderRules(db: DB) {
  return db.select().from(reminderRule).orderBy(asc(reminderRule.offsetDays));
}

export async function saveReminderRules(db: DB, actor: Actor, rows: { id?: string; offsetDays: number; hour: number; enabled: boolean }[]) {
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") throw forbidden();
  await db.transaction(async (tx) => {
    await tx.delete(reminderRule).where(eq(reminderRule.kind, "AVAILABILITY"));
    const clean = rows.filter((r) => Number.isInteger(r.offsetDays) && r.offsetDays >= -14 && r.offsetDays <= 7 && r.hour >= 0 && r.hour <= 23);
    if (clean.length) await tx.insert(reminderRule).values(clean.map((r) => ({ kind: "AVAILABILITY", offsetDays: r.offsetDays, hour: r.hour, enabled: r.enabled })));
    await writeAudit(tx, actor, { action: "reminder.rules", entityType: "reminder_rule", summary: `リマインドのタイミングを更新（${clean.map((r) => `${r.offsetDays}日`).join("・")}）` });
  });
}
