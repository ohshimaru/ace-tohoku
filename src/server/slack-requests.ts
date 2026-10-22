/**
 * Slack → Claude（Claude Code のルーティン）→ Slack
 *  1. Slack で `/ai 〇〇して` → /api/slack/command（Slack の署名を検証）
 *  2. 依頼を記録し、ルーティンを API で起動（ROUTINE_FIRE_URL / ROUTINE_FIRE_TOKEN）
 *  3. ルーティン（クラウドで動く Claude）が作業し、終わったら結果を /api/slack/result に送る（依頼ごとの署名つき）
 *  4. 結果を依頼のあったチャンネルに投稿（30分以内は返信用URL、それ以降は Webhook のチャンネル）
 * Slack の秘密情報はこのアプリだけが持ち、ルーティンには渡さない。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { slackRequest } from "@/db/schema";
import { postToSlack, slackConfigured } from "@/adapters/slack";
import { sign as signValue } from "@/lib/crypto";
import { appUrl } from "@/lib/env";

export function routineConfigured() {
  return !!(process.env.ROUTINE_FIRE_URL?.startsWith("https://api.anthropic.com/") && process.env.ROUTINE_FIRE_TOKEN);
}
export function slackCommandConfigured() {
  return !!process.env.SLACK_SIGNING_SECRET;
}

/** Slack の署名検証（v0、5分以内のリクエストのみ） */
export function verifySlackSignature(rawBody: string, ts: string | null, sig: string | null, now = Date.now()) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 許可された Slack 利用者か（SLACK_ALLOWED_USER_IDS がなければワークスペースの全員） */
export function slackUserAllowed(userId: string) {
  const list = (process.env.SLACK_ALLOWED_USER_IDS ?? "").split(/[,\s]+/).filter(Boolean);
  return list.length === 0 || list.includes(userId);
}

export function callbackToken(id: string) {
  return signValue(`slack-result:${id}`).split(".")[1];
}
export function verifyCallbackToken(id: string, token: string) {
  const want = callbackToken(id);
  const a = Buffer.from(token);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function recordRequest(db: DB, r: { userId: string; userName: string; channelId: string; text: string; responseUrl: string | null }) {
  const [row] = await db.insert(slackRequest).values({ slackUserId: r.userId, slackUserName: r.userName, channelId: r.channelId, text: r.text.slice(0, 4000), responseUrl: r.responseUrl }).returning();
  return row;
}

/** ルーティンへ渡す文面（依頼内容と、結果の送り先） */
export function routineText(row: { id: string; text: string; slackUserName: string }) {
  return [
    "【Slackからの依頼】",
    `依頼者: ${row.slackUserName}`,
    "依頼内容:",
    row.text,
    "",
    "【結果の送り方】作業が終わったら（失敗した場合も）、次のJSONを POST してください。",
    `URL: ${appUrl()}/api/slack/result`,
    `{"id":"${row.id}","token":"${callbackToken(row.id)}","status":"done または failed","result":"Slackに表示する結果（日本語・3000文字以内。長い成果物はファイルにせず要点と、必要ならセッションのURLを書く）"}`,
  ].join("\n");
}

/** ルーティンを起動し、受付を Slack に返信 */
export async function fireRoutine(db: DB, id: string) {
  const [row] = await db.select().from(slackRequest).where(eq(slackRequest.id, id)).limit(1);
  if (!row) return;
  try {
    const res = await fetch(process.env.ROUTINE_FIRE_URL!, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.ROUTINE_FIRE_TOKEN}`, "anthropic-version": "2026-10-21", "content-type": "application/json" },
      body: JSON.stringify({ text: routineText(row) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(res.status === 429 ? "1時間あたりの依頼の上限に達しました。しばらくしてから送ってください" : `Claude の起動に失敗しました（${res.status}）`);
    const j = (await res.json()) as { claude_code_session_url?: string };
    await db.update(slackRequest).set({ status: "RUNNING", sessionUrl: j.claude_code_session_url ?? null }).where(eq(slackRequest.id, id));
    await reply(row, { text: `🤖 Claude が作業を始めました：「${row.text.slice(0, 80)}」\n進み具合: ${j.claude_code_session_url ?? "（URLなし）"}\n終わったらこのチャンネルにお知らせします。`, ephemeral: true });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "起動エラー").slice(0, 200);
    await db.update(slackRequest).set({ status: "FAILED", error: msg, finishedAt: new Date() }).where(eq(slackRequest.id, id));
    await reply(row, { text: `⚠️ 依頼を受け付けられませんでした：${msg}`, ephemeral: true });
  }
}

/** ルーティンからの結果を受け取り、Slack に投稿（同じ依頼は1回だけ） */
export async function completeRequest(db: DB, input: { id: string; status: string; result: string }) {
  const done = input.status === "failed" ? "FAILED" : "DONE";
  const [row] = await db
    .update(slackRequest)
    .set({ status: done, result: input.result.slice(0, 3500), finishedAt: new Date() })
    .where(sql`${slackRequest.id} = ${input.id} and ${slackRequest.status} in ('RECEIVED', 'RUNNING')`)
    .returning();
  if (!row) return false;
  const head = done === "DONE" ? `✅ <@${row.slackUserId}> 依頼が完了しました：「${row.text.slice(0, 80)}」` : `⚠️ <@${row.slackUserId}> 依頼を完了できませんでした：「${row.text.slice(0, 80)}」`;
  await reply(row, { text: `${head}\n\n${row.result}${row.sessionUrl ? `\n\n作業の記録: ${row.sessionUrl}` : ""}`, ephemeral: false });
  return true;
}

async function reply(row: typeof slackRequest.$inferSelect, m: { text: string; ephemeral: boolean }) {
  const fresh = row.responseUrl && Date.now() - row.createdAt.getTime() < 25 * 60_000;
  try {
    if (fresh && row.responseUrl?.startsWith("https://hooks.slack.com/")) {
      const r = await fetch(row.responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: m.text, response_type: m.ephemeral ? "ephemeral" : "in_channel", replace_original: false }), signal: AbortSignal.timeout(10_000) });
      if (r.ok) return;
    }
    if (!m.ephemeral && slackConfigured()) await postToSlack({ text: m.text });
  } catch (e) {
    console.error("[slack-reply]", e instanceof Error ? e.message.slice(0, 100) : "unknown");
  }
}

export async function listSlackRequests(db: DB) {
  return db.select().from(slackRequest).orderBy(desc(slackRequest.createdAt)).limit(30);
}
