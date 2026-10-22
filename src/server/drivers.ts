/**
 * ドライバー（業務委託）の管理と、招待による安全な LINE アカウントの紐付け
 *
 * 紐付けの流れ:
 *  1. 会社側が招待を作成（1回限り・72時間有効のトークン。ハッシュのみ保存）
 *  2. ドライバーが招待リンクを開き、LINE でログイン
 *  3. LINE の利用者ID（sub）を招待された利用者に紐付け、状態を「承認待ち」にする
 *  4. 会社側が承認すると利用開始（停止すると即時にログイン不可）
 * 表示名やメールの一致だけで既存アカウントに自動で紐付けることはしない。
 */
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { appUser, division, driver, expenseCategory, oneTimeToken, partner, project } from "@/db/schema";
import { type Actor, can, canAccessDivision, divisionScope } from "@/lib/access";
import { randomToken, sha256 } from "@/lib/crypto";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { appUrl } from "@/lib/env";
import { writeAudit } from "./audit";
import { createSession, revokeUserSessions } from "./auth";
import { enqueueEmail } from "./mailer";
import { parse, zText } from "./validate";

const INVITE_HOURS = 72;
const VERIFY_HOURS = 24;

export { appUrl } from "@/lib/env";

function requireManage(actor: Actor, divisionId: string) {
  if (!can.manageDrivers(actor) || !canAccessDivision(actor, divisionId)) throw forbidden("この事業部のドライバーを管理する権限がありません");
}

const driverInput = z.object({
  name: zText("氏名", 100),
  divisionId: z.string().uuid("事業部を選んでください"),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません").optional()).optional(),
  phone: z.string().trim().max(30).optional(),
  partnerId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
});

/** ドライバーを登録して招待リンクを作る（リンクは画面に一度だけ表示し、メールがあれば送信） */
export async function inviteDriver(db: DB, actor: Actor, raw: z.input<typeof driverInput>) {
  const input = parse(driverInput, raw);
  requireManage(actor, input.divisionId);
  const token = randomToken();
  try {
    const id = await db.transaction(async (tx) => {
      if (input.partnerId) {
        const [p] = await tx.select({ isContractor: partner.isContractor }).from(partner).where(eq(partner.id, input.partnerId)).limit(1);
        if (!p?.isContractor) throw invalid("委託先として登録された取引先を選んでください");
      }
      const [u] = await tx.insert(appUser).values({ name: input.name, email: input.email ?? null, role: "DRIVER", status: "INVITED" }).returning({ id: appUser.id });
      await tx.insert(driver).values({ userId: u.id, divisionId: input.divisionId, phone: input.phone || null, partnerId: input.partnerId ?? null });
      await tx.insert(oneTimeToken).values({ purpose: "INVITE", tokenHash: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + INVITE_HOURS * 3600_000) });
      await writeAudit(tx, actor, { action: "driver.invite", entityType: "app_user", entityId: u.id, divisionId: input.divisionId, summary: `ドライバー「${input.name}」を招待` });
      if (input.email) {
        await enqueueEmail(tx, {
          dedupeKey: `invite:${u.id}:${sha256(token).slice(0, 12)}`,
          kind: "INVITE",
          toUserId: u.id,
          toEmail: input.email,
          subject: "【招待】業務委託ドライバー用ページのご案内",
          body: `${input.name} 様\n\n業務委託ドライバー用ページへ招待されました。次のリンクを開き、LINEでログインしてください（${INVITE_HOURS}時間有効・1回限り）。\n\n${appUrl()}/d/invite/${token}\n\nお心当たりがない場合はこのメールを破棄してください。`,
        });
      }
      return u.id;
    });
    return { id, inviteUrl: `${appUrl()}/d/invite/${token}` };
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("このメールアドレスは既に使われています");
    throw e;
  }
}

/** 招待リンクの再発行（以前の招待は無効になる） */
export async function reissueInvite(db: DB, actor: Actor, userId: string) {
  const token = randomToken();
  await db.transaction(async (tx) => {
    const [d] = await tx.select({ u: appUser, divisionId: driver.divisionId }).from(appUser).innerJoin(driver, eq(driver.userId, appUser.id)).where(eq(appUser.id, userId)).for("update");
    if (!d) throw notFound("ドライバーが見つかりません");
    requireManage(actor, d.divisionId);
    if (d.u.lineUserId) throw invalid("既にLINEアカウントが紐付いています");
    await tx.update(oneTimeToken).set({ usedAt: new Date() }).where(and(eq(oneTimeToken.userId, userId), eq(oneTimeToken.purpose, "INVITE"), isNull(oneTimeToken.usedAt)));
    await tx.insert(oneTimeToken).values({ purpose: "INVITE", tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + INVITE_HOURS * 3600_000) });
    await writeAudit(tx, actor, { action: "driver.invite_reissue", entityType: "app_user", entityId: userId, divisionId: d.divisionId, summary: `ドライバー「${d.u.name}」の招待を再発行` });
  });
  return `${appUrl()}/d/invite/${token}`;
}

/** 招待トークンの確認（使用前の表示用） */
export async function peekInvite(db: DB, token: string) {
  const [t] = await db
    .select({ t: oneTimeToken, name: appUser.name, status: appUser.status, line: appUser.lineUserId })
    .from(oneTimeToken)
    .innerJoin(appUser, eq(appUser.id, oneTimeToken.userId))
    .where(and(eq(oneTimeToken.tokenHash, sha256(token)), eq(oneTimeToken.purpose, "INVITE"), isNull(oneTimeToken.usedAt), gt(oneTimeToken.expiresAt, new Date())))
    .limit(1);
  if (!t || t.line || t.status === "SUSPENDED") return null;
  return { name: t.name };
}

/**
 * LINE アカウントを招待された利用者に紐付ける（招待トークンが必須）
 * - トークンは1回限り（同時実行でも1回だけ成功）
 * - 既に別の利用者に紐付いた LINE アカウントは拒否
 */
export async function bindLineAccount(db: DB, inviteToken: string, line: { sub: string; displayName?: string }) {
  if (!/^U[0-9a-f]{32}$/.test(line.sub) && !/^Udemo[0-9a-f]{28}$/.test(line.sub)) throw invalid("LINEの利用者IDが不正です");
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(oneTimeToken)
      .set({ usedAt: new Date() })
      .where(and(eq(oneTimeToken.tokenHash, sha256(inviteToken)), eq(oneTimeToken.purpose, "INVITE"), isNull(oneTimeToken.usedAt), gt(oneTimeToken.expiresAt, new Date())))
      .returning();
    if (!t?.userId) throw invalid("招待リンクが無効か期限切れです。会社の担当者に再発行を依頼してください");
    const [taken] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.lineUserId, line.sub)).limit(1);
    if (taken && taken.id !== t.userId) throw conflict("このLINEアカウントは既に別の利用者に紐付いています");
    const [u] = await tx.select().from(appUser).where(eq(appUser.id, t.userId)).for("update");
    if (!u || u.role !== "DRIVER" || u.status === "SUSPENDED") throw forbidden("この招待は使えません");
    if (u.lineUserId && u.lineUserId !== line.sub) throw conflict("既に別のLINEアカウントが紐付いています");
    await tx.update(appUser).set({ lineUserId: line.sub, lineDisplayName: line.displayName ?? null, status: u.status === "ACTIVE" ? "ACTIVE" : "PENDING" }).where(eq(appUser.id, u.id));
    await writeAudit(tx, { userId: u.id, name: u.name }, { action: "driver.line_bind", entityType: "app_user", entityId: u.id, summary: "招待リンクからLINEアカウントを紐付け（承認待ち）" });
    return { userId: u.id, status: u.status === "ACTIVE" ? "ACTIVE" : "PENDING" };
  });
}

/** LINE ログイン（紐付け済み・利用中のドライバーのみ） */
export async function loginWithLine(db: DB, sub: string, opts: { demo?: boolean } = {}) {
  const [u] = await db.select().from(appUser).where(eq(appUser.lineUserId, sub)).limit(1);
  if (!u) return { result: "NOT_LINKED" as const };
  if (u.status === "SUSPENDED") return { result: "SUSPENDED" as const };
  if (u.status !== "ACTIVE") return { result: "PENDING" as const };
  const token = await db.transaction(async (tx) => {
    const t = await createSession(tx, u.id, { demo: opts.demo });
    await writeAudit(tx, { userId: u.id, name: u.name }, { action: opts.demo ? "auth.demo_line_login" : "auth.line_login", entityType: "app_user", entityId: u.id, summary: opts.demo ? "デモLINEログイン（開発環境）" : "LINEでログイン" });
    return t;
  });
  return { result: "OK" as const, token };
}

export async function setDriverStatus(db: DB, actor: Actor, userId: string, status: "ACTIVE" | "SUSPENDED") {
  await db.transaction(async (tx) => {
    const [d] = await tx.select({ u: appUser, divisionId: driver.divisionId }).from(appUser).innerJoin(driver, eq(driver.userId, appUser.id)).where(eq(appUser.id, userId)).for("update");
    if (!d) throw notFound("ドライバーが見つかりません");
    requireManage(actor, d.divisionId);
    if (status === "ACTIVE" && !d.u.lineUserId) throw invalid("LINEアカウントが紐付いていないため承認できません。招待リンクからログインしてもらってください");
    await tx.update(appUser).set({ status, ...(status === "ACTIVE" ? { approvedAt: new Date(), approvedById: actor.userId } : {}) }).where(eq(appUser.id, userId));
    if (status === "SUSPENDED") await revokeUserSessions(tx, userId);
    await writeAudit(tx, actor, { action: status === "ACTIVE" ? "driver.approve" : "driver.suspend", entityType: "app_user", entityId: userId, divisionId: d.divisionId, summary: `ドライバー「${d.u.name}」を${status === "ACTIVE" ? "承認（利用開始）" : "停止"}` });
  });
}

const profileInput = z.object({
  qualifications: z.string().default(""),
  vehicles: z.string().default(""),
  areas: z.string().default(""),
  maxDaysPerMonth: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(31).optional()).optional(),
  maxHoursPerDay: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(1).max(24).optional()).optional(),
  taxMode: z.enum(["EXCLUSIVE", "INCLUSIVE", "EXEMPT"]),
  withholdingEnabled: z.coerce.boolean(),
  withholdingConfirmedNote: z.string().trim().max(500).default(""),
  partnerId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()).optional(),
  preferredProjectIds: z.array(z.string().uuid()).default([]),
  note: z.string().trim().max(1000).default(""),
});

const list = (s: string) => Array.from(new Set(s.split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean))).slice(0, 30);

export async function updateDriverProfile(db: DB, actor: Actor, userId: string, raw: z.input<typeof profileInput>) {
  const input = parse(profileInput, raw);
  if (input.withholdingEnabled && !input.withholdingConfirmedNote) throw invalid("源泉徴収を適用する場合は、確認した内容（確認日・確認先など）を記録してください");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(driver).where(eq(driver.userId, userId)).for("update");
    if (!d) throw notFound("ドライバーが見つかりません");
    requireManage(actor, d.divisionId);
    if (input.partnerId) {
      const [p] = await tx.select({ isContractor: partner.isContractor }).from(partner).where(eq(partner.id, input.partnerId)).limit(1);
      if (!p?.isContractor) throw invalid("委託先として登録された取引先を選んでください");
    }
    if (input.preferredProjectIds.length) {
      const ok = await tx.select({ id: project.id }).from(project).where(and(inArray(project.id, input.preferredProjectIds), eq(project.divisionId, d.divisionId)));
      if (ok.length !== new Set(input.preferredProjectIds).size) throw invalid("希望案件は所属事業部の案件から選んでください");
    }
    const values = {
      qualifications: list(input.qualifications),
      vehicles: list(input.vehicles),
      areas: list(input.areas),
      maxDaysPerMonth: input.maxDaysPerMonth ?? null,
      maxMinutesPerDay: input.maxHoursPerDay ? Math.round(input.maxHoursPerDay * 60) : null,
      taxMode: input.taxMode,
      withholdingEnabled: input.withholdingEnabled,
      withholdingConfirmedNote: input.withholdingConfirmedNote || null,
      partnerId: input.partnerId ?? null,
      preferredProjectIds: input.preferredProjectIds,
      note: input.note || null,
    };
    await tx.update(driver).set(values).where(eq(driver.userId, userId));
    await writeAudit(tx, actor, { action: "driver.update", entityType: "app_user", entityId: userId, divisionId: d.divisionId, summary: "ドライバーの条件を更新", changes: { before: d, after: values } });
  });
}

export async function listDrivers(db: DB, actor: Actor, opts: { divisionId?: string; status?: string } = {}) {
  if (actor.role === "DRIVER") throw forbidden();
  const scope = divisionScope(actor);
  return db
    .select({ u: { id: appUser.id, name: appUser.name, email: appUser.email, emailVerifiedAt: appUser.emailVerifiedAt, status: appUser.status, lineLinked: sql<boolean>`${appUser.lineUserId} is not null`, lastLoginAt: appUser.lastLoginAt }, d: driver, divisionName: division.name, partnerName: partner.name })
    .from(appUser)
    .innerJoin(driver, eq(driver.userId, appUser.id))
    .innerJoin(division, eq(division.id, driver.divisionId))
    .leftJoin(partner, eq(partner.id, driver.partnerId))
    .where(and(scope ? (scope.length ? inArray(driver.divisionId, scope) : sql`false`) : undefined, opts.divisionId ? eq(driver.divisionId, opts.divisionId) : undefined, opts.status ? sql`${appUser.status} = ${opts.status}` : undefined))
    .orderBy(asc(appUser.status), asc(appUser.name));
}

export async function getDriver(db: Tx, actor: Actor, userId: string) {
  const [r] = await db
    .select({ u: appUser, d: driver, divisionName: division.name })
    .from(appUser)
    .innerJoin(driver, eq(driver.userId, appUser.id))
    .innerJoin(division, eq(division.id, driver.divisionId))
    .where(eq(appUser.id, userId))
    .limit(1);
  if (!r) throw notFound("ドライバーが見つかりません");
  if (actor.role === "DRIVER" ? actor.userId !== userId : !canAccessDivision(actor, r.d.divisionId)) throw notFound("ドライバーが見つかりません");
  return { ...r, u: { ...r.u, passwordHash: undefined } };
}

/* ---------------- メールの登録と確認（リマインド用） ---------------- */

export async function requestEmailVerification(db: DB, actor: Actor, email: string) {
  const e = parse(z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"), email);
  const token = randomToken();
  await db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: appUser.id }).from(appUser).where(and(sql`lower(${appUser.email}) = ${e}`, sql`${appUser.id} <> ${actor.userId}`)).limit(1);
    if (dup) throw conflict("このメールアドレスは他の利用者が使っています");
    // 前回の確認リンクは無効にする
    await tx.update(oneTimeToken).set({ usedAt: new Date() }).where(and(eq(oneTimeToken.userId, actor.userId), eq(oneTimeToken.purpose, "EMAIL_VERIFY"), isNull(oneTimeToken.usedAt)));
    await tx.insert(oneTimeToken).values({ purpose: "EMAIL_VERIFY", tokenHash: sha256(token), userId: actor.userId, payload: { email: e }, expiresAt: new Date(Date.now() + VERIFY_HOURS * 3600_000) });
    await enqueueEmail(tx, {
      dedupeKey: `verify:${actor.userId}:${sha256(token).slice(0, 12)}`,
      kind: "EMAIL_VERIFY",
      toUserId: actor.userId,
      toEmail: e,
      subject: "【確認】メールアドレスの登録",
      body: `次のリンクを開くと、リマインドの送信先としてこのメールアドレスが登録されます（${VERIFY_HOURS}時間有効）。\n\n${appUrl()}/d/verify-email/${token}\n\nお心当たりがない場合はこのメールを破棄してください。`,
    });
    await writeAudit(tx, actor, { action: "email.verify_request", entityType: "app_user", entityId: actor.userId, summary: "メールアドレスの確認メールを送信" });
  });
}

export async function confirmEmail(db: DB, token: string) {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(oneTimeToken)
      .set({ usedAt: new Date() })
      .where(and(eq(oneTimeToken.tokenHash, sha256(token)), eq(oneTimeToken.purpose, "EMAIL_VERIFY"), isNull(oneTimeToken.usedAt), gt(oneTimeToken.expiresAt, new Date())))
      .returning();
    if (!t?.userId || !t.payload.email) throw invalid("確認リンクが無効か期限切れです。もう一度登録してください");
    try {
      await tx.update(appUser).set({ email: t.payload.email, emailVerifiedAt: new Date() }).where(eq(appUser.id, t.userId));
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("このメールアドレスは他の利用者が使っています");
      throw e;
    }
    await writeAudit(tx, { userId: t.userId, name: "本人" }, { action: "email.verified", entityType: "app_user", entityId: t.userId, summary: "メールアドレスを確認" });
    return t.userId;
  });
}

/** ドライバー本人の所属事業部・選べる案件・費目（日報・経費の入力用） */
export async function myDriverContext(db: DB, actor: Actor) {
  if (actor.role !== "DRIVER") throw forbidden();
  const [r] = await db.select({ d: driver, divisionName: division.name, email: appUser.email, emailVerifiedAt: appUser.emailVerifiedAt }).from(driver).innerJoin(division, eq(division.id, driver.divisionId)).innerJoin(appUser, eq(appUser.id, driver.userId)).where(eq(driver.userId, actor.userId)).limit(1);
  if (!r) throw forbidden("ドライバー情報が登録されていません");
  const projects = await db
    .select({ id: project.id, code: project.code, name: project.name, reportFields: project.reportFields })
    .from(project)
    .where(and(eq(project.divisionId, r.d.divisionId), isNull(project.archivedAt), inArray(project.status, ["ACTIVE", "PAUSED"])))
    .orderBy(asc(project.code));
  const categories = await db.select({ id: expenseCategory.id, name: expenseCategory.name }).from(expenseCategory).where(and(isNull(expenseCategory.archivedAt), eq(expenseCategory.isOutsourcing, false))).orderBy(asc(expenseCategory.sortOrder), asc(expenseCategory.name));
  return { divisionId: r.d.divisionId, divisionName: r.divisionName, email: r.email, emailVerified: !!r.emailVerifiedAt, projects, categories };
}
