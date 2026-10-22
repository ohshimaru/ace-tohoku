import { after, NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { fireRoutine, recordRequest, routineConfigured, slackUserAllowed, verifySlackSignature } from "@/server/slack-requests";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Slack のスラッシュコマンド（例: /ai 来月のシフト案の注意点をまとめて） */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) return new NextResponse("invalid signature", { status: 401 });
  const p = new URLSearchParams(raw);
  const text = (p.get("text") ?? "").trim();
  const userId = p.get("user_id") ?? "";
  const say = (t: string) => NextResponse.json({ response_type: "ephemeral", text: t });
  if (!slackUserAllowed(userId)) return say("この依頼を送る権限がありません（管理者に許可を依頼してください）");
  if (!text || text === "help") return say("使い方: `/ai やってほしいこと` と送ると Claude が作業し、終わったらこのチャンネルに結果を返します。\n例: `/ai 来週の配送の稼働に足りない枠をまとめて`");
  if (!routineConfigured()) return say("Claude との接続（ルーティン）がまだ設定されていません");
  const db = getDb();
  const row = await recordRequest(db, { userId, userName: p.get("user_name") ?? "", channelId: p.get("channel_id") ?? "", text, responseUrl: p.get("response_url") });
  after(() => fireRoutine(db, row.id));
  return say(`受け付けました：「${text.slice(0, 80)}」 Claude を起動しています…`);
}
