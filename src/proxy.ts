import { NextResponse, type NextRequest } from "next/server";

/** 楽観的チェックのみ。実際の認証・権限判定は各ページ・アクション・APIで行う */
export function proxy(req: NextRequest) {
  const has = req.cookies.has("an_session");
  const p = req.nextUrl.pathname;
  if (!has && p.startsWith("/app")) return NextResponse.redirect(new URL("/login", req.url));
  if (!has && p.startsWith("/d") && !p.startsWith("/d/login") && !p.startsWith("/d/invite")) return NextResponse.redirect(new URL("/d/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/d/:path*"] };
