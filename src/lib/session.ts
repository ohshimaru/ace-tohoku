import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { type Actor, isStaff } from "@/lib/access";
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

/** 会社側ページ用 */
export async function requireStaff(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (!isStaff(a)) redirect("/d");
  return a;
}

/** ドライバー側ページ用 */
export async function requireDriver(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/d/login");
  if (a.role !== "DRIVER") redirect("/app");
  return a;
}

/** Server Action / Route Handler 用 */
export async function requireActorForAction(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new AppError("UNAUTHENTICATED", "ログインが必要です。再度ログインしてください");
  return a;
}
