import { NextResponse, type NextRequest } from "next/server";
import { lineConfigured, startLineFlow } from "@/adapters/line";
import { sign } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!lineConfigured()) return NextResponse.redirect(new URL("/d/login?e=not_configured", req.url));
  const invite = req.nextUrl.searchParams.get("invite") || undefined;
  if (invite && !/^[A-Za-z0-9_-]{20,100}$/.test(invite)) return NextResponse.redirect(new URL("/d/login?e=invalid", req.url));
  const { url, flow } = startLineFlow(invite);
  const res = NextResponse.redirect(url);
  res.cookies.set("an_line", sign(JSON.stringify(flow)), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/line", maxAge: 600 });
  return res;
}
