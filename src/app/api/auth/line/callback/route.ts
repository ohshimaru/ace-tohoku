import { NextResponse, type NextRequest } from "next/server";
import { finishLineFlow, type LineFlow } from "@/adapters/line";
import { getDb } from "@/db";
import { unsign } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { SESSION_COOKIE, SESSION_DAYS } from "@/server/auth";
import { bindLineAccount, loginWithLine } from "@/server/drivers";

export const dynamic = "force-dynamic";

function to(req: NextRequest, path: string) {
  const res = NextResponse.redirect(new URL(path, req.url));
  res.cookies.delete({ name: "an_line", path: "/api/auth/line" });
  return res;
}

export async function GET(req: NextRequest) {
  const raw = unsign(req.cookies.get("an_line")?.value);
  const flow = raw ? (JSON.parse(raw) as LineFlow) : null;
  const sp = req.nextUrl.searchParams;
  if (!flow || Date.now() - flow.at > 600_000 || sp.get("state") !== flow.state) return to(req, "/d/login?e=state");
  if (sp.get("error") || !sp.get("code")) return to(req, "/d/login?e=canceled");
  let sub: string;
  try {
    sub = (await finishLineFlow(sp.get("code")!, flow)).sub;
  } catch (e) {
    console.error("[line-login]", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return to(req, "/d/login?e=line_error");
  }
  const db = getDb();
  if (flow.invite) {
    try {
      const r = await bindLineAccount(db, flow.invite, { sub });
      if (r.status !== "ACTIVE") return to(req, "/d/login?e=linked");
    } catch (e) {
      if (e instanceof AppError) return to(req, `/d/login?e=${e.code === "CONFLICT" ? "taken" : "invite"}`);
      throw e;
    }
  }
  const r = await loginWithLine(db, sub);
  if (r.result !== "OK") return to(req, `/d/login?e=${r.result.toLowerCase()}`);
  const res = to(req, "/d");
  res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  return res;
}
