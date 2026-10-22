import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { completeRequest, verifyCallbackToken } from "@/server/slack-requests";

export const dynamic = "force-dynamic";

/** ルーティン（Claude）からの結果受け取り。依頼ごとの署名トークンで検証 */
export async function POST(req: NextRequest) {
  let body: { id?: unknown; token?: unknown; status?: unknown; result?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON で送ってください" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !token || !verifyCallbackToken(id, token)) return NextResponse.json({ error: "invalid token" }, { status: 401 });
  const result = typeof body.result === "string" ? body.result : "";
  if (!result.trim()) return NextResponse.json({ error: "result が空です" }, { status: 400 });
  const ok = await completeRequest(getDb(), { id, status: body.status === "failed" ? "failed" : "done", result });
  return NextResponse.json({ ok, note: ok ? "Slack に投稿しました" : "この依頼は既に完了しています" });
}
