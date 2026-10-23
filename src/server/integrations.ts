/** 外部接続の状態（画面に「未接続 / デモ / 実接続」を表示する） */
import type { DB } from "@/db";
import { emailDriver } from "@/adapters/email";
import { storageDriver } from "@/adapters/storage";
import { demoLoginAllowed } from "./auth";

export type ConnState = "LIVE" | "DEMO" | "NONE";
export type Conn = { key: string; label: string; state: ConnState; detail: string };

export async function connectionStatus(db: DB): Promise<Conn[]> {
  void db;
  const line = !!(process.env.LINE_CHANNEL_ID && process.env.LINE_CHANNEL_SECRET);
  const mail = emailDriver();
  const llm = !!process.env.ANTHROPIC_API_KEY;
  return [
    { key: "bank", label: "銀行連携", state: "NONE", detail: "サービス提供者が管理（銀行API・口座情報サービスは未接続。CSV取込とデモ口座）。本社には提供者が公開した入出金だけが表示されます" },
    { key: "line", label: "LINEログイン", state: line ? "LIVE" : demoLoginAllowed() ? "DEMO" : "NONE", detail: line ? "LINE Login チャネル設定済み" : demoLoginAllowed() ? "未設定（開発環境のデモログインのみ）" : "未設定（ドライバーはログインできません）" },
    { key: "email", label: "メール送信", state: mail === "console" ? "DEMO" : "LIVE", detail: mail === "console" ? "送信せず履歴に記録のみ" : mail === "smtp" ? "SMTPで送信" : "Resendで送信" },
    { key: "storage", label: "ファイル保存", state: storageDriver() === "local" ? "DEMO" : "LIVE", detail: storageDriver() === "supabase" ? "Supabase Storage（非公開）" : storageDriver() === "db" ? "データベース内に非公開で保存" : "サーバーのディスク（開発用）" },
    { key: "llm", label: "AI文章（LLM）", state: llm ? "LIVE" : "NONE", detail: llm ? "Claude API で説明文を整形（数値は送らない範囲を限定）" : "未接続（ルールベースの文章で表示）" },
    { key: "esign", label: "電子署名", state: "NONE", detail: "未接続（将来接続できる構成のみ）" },
    { key: "slack", label: "Slack（毎日の要約）", state: process.env.SLACK_WEBHOOK_URL?.startsWith("https://hooks.slack.com/") ? "LIVE" : "NONE", detail: process.env.SLACK_WEBHOOK_URL ? "Incoming Webhook で毎朝投稿" : "未設定（SLACK_WEBHOOK_URL）" },
    { key: "claude", label: "Slack から Claude へ依頼", state: process.env.SLACK_SIGNING_SECRET && process.env.ROUTINE_FIRE_TOKEN ? "LIVE" : "NONE", detail: process.env.SLACK_SIGNING_SECRET && process.env.ROUTINE_FIRE_TOKEN ? "/ai コマンド → Claude Code のルーティン" : "未設定（Slack アプリと Claude のルーティン）" },
    { key: "cleanup", label: "Clean Up", state: "NONE", detail: "API なし。請求書CSVの取込と画面への導線で連携" },
  ];
}
