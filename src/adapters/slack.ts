import "server-only";
/**
 * Slack への投稿（Incoming Webhook）
 * - SLACK_WEBHOOK_URL に Slack で発行した Webhook URL を設定（利用者が Vercel の環境変数に入力）
 * - URL は秘密情報として扱い、ログ・画面に出さない
 * - 投稿先チャンネルは Webhook 作成時に Slack 側で決まる
 */
export function slackConfigured() {
  const u = process.env.SLACK_WEBHOOK_URL ?? "";
  return u.startsWith("https://hooks.slack.com/");
}

export async function postToSlack(payload: { text: string; blocks?: unknown[] }) {
  if (!slackConfigured()) throw new Error("Slack の送信先（SLACK_WEBHOOK_URL）が設定されていません");
  const res = await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Slack への送信に失敗しました（${res.status}）`);
}
