"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { type ActionResult, str } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { clearSessionCookie, getActor, setSessionCookie } from "@/lib/session";
import { demoLogin, destroySession, loginWithPassword, SESSION_COOKIE } from "@/server/auth";
import { cookies } from "next/headers";

async function clientIp() {
  const h = await headers();
  const trusted = process.env.TRUSTED_IP_HEADER;
  return (trusted && h.get(trusted)?.split(",")[0]?.trim()) || "direct";
}

export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let role = "";
  try {
    const r = await loginWithPassword(getDb(), str(fd, "email"), str(fd, "password"), await clientIp());
    await setSessionCookie(r.token);
    role = r.role;
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, at: Date.now() };
    console.error("[login-error]", e instanceof Error ? e.name : "unknown");
    return { ok: false, message: "ログインに失敗しました。時間をおいて再度お試しください", at: Date.now() };
  }
  redirect(role === "DRIVER" ? "/d" : "/app");
}

export async function demoLoginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let role = "";
  try {
    const r = await demoLogin(getDb(), str(fd, "userId"));
    await setSessionCookie(r.token);
    role = r.role;
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  redirect(role === "DRIVER" ? "/d" : "/app");
}

export async function logoutAction() {
  const a = await getActor();
  await destroySession(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect(a?.role === "DRIVER" ? "/d/login" : "/login");
}
