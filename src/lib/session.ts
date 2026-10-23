import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { type Actor, isProvider, isStaff } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { actorFromToken, SESSION_COOKIE, SESSION_DAYS } from "@/server/auth";

export const getActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  return actorFromToken(getDb(), jar.get(SESSION_COOKIE)?.value);
});

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** ログイン後の最初の画面 */
export function homeFor(a: Pick<Actor, "role">) {
  return a.role === "DRIVER" ? "/d" : a.role === "PROVIDER" ? "/p" : "/app";
}

/** 会社側（本社）ページ用 */
export async function requireStaff(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (!isStaff(a)) redirect(homeFor(a));
  return a;
}

/** ドライバー（スタッフ）側ページ用 */
export async function requireDriver(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/d/login");
  if (a.role !== "DRIVER") redirect(homeFor(a));
  return a;
}

/** サービス提供者ページ用 */
export async function requireProvider(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (!isProvider(a)) redirect(homeFor(a));
  return a;
}

/**
 * 本社・スタッフの Server Action / Route Handler 用。
 * サービス提供者はここを通れない（提供者の操作は requireProviderForAction を使う専用の処理だけ）
 */
export async function requireActorForAction(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new AppError("UNAUTHENTICATED", "ログインが必要です。再度ログインしてください");
  if (isProvider(a)) throw new AppError("FORBIDDEN", "この操作はサービス提供者画面からは行えません");
  return a;
}

/** 本社・スタッフの Route Handler 用（提供者・未ログインは null） */
export async function getCompanyActor(): Promise<Actor | null> {
  const a = await getActor();
  return a && !isProvider(a) ? a : null;
}

/** サービス提供者の Server Action / Route Handler 用 */
export async function requireProviderForAction(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new AppError("UNAUTHENTICATED", "ログインが必要です。再度ログインしてください");
  if (!isProvider(a)) throw new AppError("FORBIDDEN", "サービス提供者のみ操作できます");
  return a;
}
