import "server-only";
/**
 * LINE Login（OpenID Connect + PKCE）
 * - 使うのは「ログイン」だけ。メッセージ送信（Messaging API）は使わない
 * - 取得するのは LINE の利用者ID（sub）のみ（scope=openid）。プロフィールやメールは取得しない
 * - IDトークンは LINE の検証エンドポイントで検証（署名・発行者・宛先・有効期限・nonce）
 * 必要な環境変数: LINE_CHANNEL_ID, LINE_CHANNEL_SECRET（Vercel 等で利用者が設定）
 * コールバックURL: {APP_URL}/api/auth/line/callback を LINE Developers に登録
 */
import { createHash, randomBytes } from "node:crypto";
import { appUrl } from "@/lib/env";

const AUTHORIZE = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN = "https://api.line.me/oauth2/v2.1/token";
const VERIFY = "https://api.line.me/oauth2/v2.1/verify";

export function lineConfigured() {
  return !!(process.env.LINE_CHANNEL_ID && process.env.LINE_CHANNEL_SECRET);
}

function callbackUrl() {
  return `${appUrl()}/api/auth/line/callback`;
}

export type LineFlow = { state: string; nonce: string; verifier: string; invite?: string; at: number };

export function startLineFlow(invite?: string): { url: string; flow: LineFlow } {
  const flow: LineFlow = { state: randomBytes(16).toString("base64url"), nonce: randomBytes(16).toString("base64url"), verifier: randomBytes(32).toString("base64url"), invite, at: Date.now() };
  const challenge = createHash("sha256").update(flow.verifier).digest("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINE_CHANNEL_ID!,
    redirect_uri: callbackUrl(),
    state: flow.state,
    scope: "openid",
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTHORIZE}?${q}`, flow };
}

/** 認可コードを LINE の利用者ID（sub）に交換する */
export async function finishLineFlow(code: string, flow: LineFlow): Promise<{ sub: string }> {
  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(), client_id: process.env.LINE_CHANNEL_ID!, client_secret: process.env.LINE_CHANNEL_SECRET!, code_verifier: flow.verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`LINE token ${tokenRes.status}`);
  const tok = (await tokenRes.json()) as { id_token?: string };
  if (!tok.id_token) throw new Error("LINE token: id_token missing");
  const verRes = await fetch(VERIFY, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: tok.id_token, client_id: process.env.LINE_CHANNEL_ID!, nonce: flow.nonce }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!verRes.ok) throw new Error(`LINE verify ${verRes.status}`);
  const claims = (await verRes.json()) as { sub?: string; aud?: string; iss?: string };
  if (!claims.sub || claims.aud !== process.env.LINE_CHANNEL_ID || claims.iss !== "https://access.line.me") throw new Error("LINE verify: claims mismatch");
  return { sub: claims.sub };
}
