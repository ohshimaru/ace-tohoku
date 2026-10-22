/** 認証（セッション・パスワード・ログイン試行制限） */
import { and, count, eq, gt, inArray, like, lt } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { appUser, loginAttempt, session, userDivision } from "@/db/schema";
import type { Actor, Role } from "@/lib/access";
import { randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { writeAudit } from "./audit";

export const SESSION_COOKIE = "an_session";
export const SESSION_DAYS = 14;

/**
 * デモログイン（パスワードなしで利用者を選んでログイン）
 * - 開発環境: DEMO_LOGIN=true のときだけ
 * - 本番ビルド: 実データの本番では使えない。架空データだけの「デモ環境」として公開する場合に限り、
 *   DEMO_ENVIRONMENT=true を設定したときだけ有効。
 *   その場合もデモ用アカウント（@demo.invalid）以外にはデモログインできない
 */
export function demoLoginAllowed() {
  if (process.env.NODE_ENV === "production") return process.env.DEMO_ENVIRONMENT === "true";
  return process.env.DEMO_LOGIN === "true" || process.env.DEMO_ENVIRONMENT === "true";
}
export const DEMO_EMAIL_DOMAIN = "@demo.invalid";
function demoUserOnly() {
  return process.env.NODE_ENV === "production";
}

export async function createSession(db: Tx, userId: string, opts: { demo?: boolean } = {}) {
  const token = randomToken();
  await db.insert(session).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
    demo: !!opts.demo,
  });
  await db.update(appUser).set({ lastLoginAt: new Date() }).where(eq(appUser.id, userId));
  return token;
}

export async function destroySession(db: DB, token: string | undefined) {
  if (token) await db.delete(session).where(eq(session.tokenHash, sha256(token)));
}

export async function revokeUserSessions(db: Tx, userId: string) {
  await db.delete(session).where(eq(session.userId, userId));
}

/** セッションから操作者を解決。停止中・承認待ち・期限切れは null */
export async function actorFromToken(db: DB, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const [row] = await db
    .select({ s: session, u: appUser })
    .from(session)
    .innerJoin(appUser, eq(appUser.id, session.userId))
    .where(and(eq(session.tokenHash, sha256(token)), gt(session.expiresAt, new Date())))
    .limit(1);
  if (!row || row.u.status !== "ACTIVE") return null;
  if (row.s.demo && !demoLoginAllowed()) return null;
  const divs = row.u.role === "MANAGER" ? await db.select({ id: userDivision.divisionId }).from(userDivision).where(eq(userDivision.userId, row.u.id)) : [];
  return {
    userId: row.u.id,
    name: row.u.name,
    email: row.u.email,
    role: row.u.role as Role,
    divisionIds: divs.map((d) => d.id),
    demo: row.s.demo,
  };
}

const WINDOW_MS = 15 * 60_000;
const LIMIT_PER_EMAIL = 5;
const LIMIT_PER_IP = 20;

async function tooMany(db: DB, key: string, limit: number) {
  const [{ n }] = await db.select({ n: count() }).from(loginAttempt).where(and(eq(loginAttempt.key, key), gt(loginAttempt.at, new Date(Date.now() - WINDOW_MS))));
  return n >= limit;
}

/** 会社側（メール＋パスワード）のログイン。ドライバーは LINE ログインを使う */
export async function loginWithPassword(db: DB, email: string, password: string, ip: string) {
  const e = email.trim().toLowerCase();
  if (await tooMany(db, `email:${e}`, LIMIT_PER_EMAIL) || await tooMany(db, `ip:${ip}`, LIMIT_PER_IP)) {
    throw new AppError("FORBIDDEN", "ログインの失敗が続いたため、一時的に制限しています。15分ほど待ってから再度お試しください");
  }
  const [u] = await db.select().from(appUser).where(eq(appUser.email, e)).limit(1);
  const ok = await verifyPassword(password, u?.passwordHash ?? null);
  if (!u || !ok) {
    await db.insert(loginAttempt).values([{ key: `email:${e}` }, { key: `ip:${ip}` }]);
    throw new AppError("VALIDATION", "メールアドレスまたはパスワードが正しくありません");
  }
  if (u.status === "SUSPENDED") throw new AppError("FORBIDDEN", "このアカウントは停止されています。管理者にお問い合わせください");
  if (u.status !== "ACTIVE") throw new AppError("FORBIDDEN", "このアカウントはまだ利用できません（承認待ち）");
  await db.delete(loginAttempt).where(eq(loginAttempt.key, `email:${e}`));
  await db.delete(loginAttempt).where(lt(loginAttempt.at, new Date(Date.now() - 86400_000)));
  return db.transaction(async (tx) => {
    const token = await createSession(tx, u.id);
    await writeAudit(tx, { userId: u.id, name: u.name }, { action: "auth.login", entityType: "app_user", entityId: u.id, summary: "ログイン（メール）" });
    return { token, role: u.role as Role };
  });
}

/** 開発環境限定のデモログイン（本番では常に拒否） */
export async function demoLogin(db: DB, userId: string) {
  if (!demoLoginAllowed()) throw new AppError("FORBIDDEN", "デモログインはこの環境では使えません");
  const [u] = await db.select().from(appUser).where(and(eq(appUser.id, userId), eq(appUser.status, "ACTIVE"))).limit(1);
  if (!u) throw new AppError("NOT_FOUND", "利用者が見つかりません");
  if (demoUserOnly() && !u.email?.endsWith(DEMO_EMAIL_DOMAIN)) throw new AppError("FORBIDDEN", "デモ用アカウント以外はデモログインできません");
  return db.transaction(async (tx) => {
    const token = await createSession(tx, u.id, { demo: true });
    await writeAudit(tx, { userId: u.id, name: u.name }, { action: "auth.demo_login", entityType: "app_user", entityId: u.id, summary: "デモログイン（開発環境）" });
    return { token, role: u.role as Role };
  });
}

export async function listDemoUsers(db: DB) {
  if (!demoLoginAllowed()) return [];
  return db
    .select({ id: appUser.id, name: appUser.name, role: appUser.role })
    .from(appUser)
    .where(and(eq(appUser.status, "ACTIVE"), inArray(appUser.role, ["OWNER", "ACCOUNTING", "MANAGER", "DRIVER"]), demoUserOnly() ? like(appUser.email, `%${DEMO_EMAIL_DOMAIN}`) : undefined))
    .orderBy(appUser.role, appUser.name);
}
