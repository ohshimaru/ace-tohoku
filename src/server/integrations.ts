/** 外部接続の状態（画面に「未接続 / デモ / 実接続」を表示する） */
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { emailDriver } from "@/adapters/email";
import { storageDriver } from "@/adapters/storage";
import { demoLoginAllowed } from "./auth";

export type ConnState = "LIVE" | "DEMO" | "NONE";
export type Conn = { key: string; label: string; state: ConnState; detail: string };

export async function connectionStatus(db: DB): Promise<Conn[]> {
  const bank = await db.execute<{ demo: number; live: number; csv: number }>(sql`
    select count(*) filter (where is_demo)::int demo, count(*) filter (where not is_demo and provider not in ('CSV','DEMO'))::int live,
      count(*) filter (where provider = 'CSV' and not is_demo)::int csv from bank_account where archived_at is null`);
  const b = bank.rows[0];
  const line = !!(process.env.LINE_CHANNEL_ID && process.env.LINE_CHANNEL_SECRET);
  const mail = emailDriver();
  const llm = !!process.env.ANTHROPIC_API_KEY;
  return [
    { key: "bank", label: "銀行連携", state: b.live ? "LIVE" : b.demo ? "DEMO" : "NONE", detail: b.live ? "連携サービス経由" : b.demo ? "デモ口座・デモ取引（実在しない口座）" : b.csv ? "CSV取込のみ（API未接続）" : "未接続（口座未登録）" },
    { key: "line", label: "LINEログイン", state: line ? "LIVE" : demoLoginAllowed() ? "DEMO" : "NONE", detail: line ? "LINE Login チャネル設定済み" : demoLoginAllowed() ? "未設定（開発環境のデモログインのみ）" : "未設定（ドライバーはログインできません）" },
    { key: "email", label: "メール送信", state: mail === "console" ? "DEMO" : "LIVE", detail: mail === "console" ? "送信せず履歴に記録のみ" : mail === "smtp" ? "SMTPで送信" : "Resendで送信" },
    { key: "storage", label: "ファイル保存", state: storageDriver() === "local" ? "DEMO" : "LIVE", detail: storageDriver() === "supabase" ? "Supabase Storage（非公開）" : storageDriver() === "db" ? "データベース内に非公開で保存" : "サーバーのディスク（開発用）" },
    { key: "llm", label: "AI文章（LLM）", state: llm ? "LIVE" : "NONE", detail: llm ? "Claude API で説明文を整形（数値は送らない範囲を限定）" : "未接続（ルールベースの文章で表示）" },
    { key: "esign", label: "電子署名", state: "NONE", detail: "未接続（将来接続できる構成のみ）" },
    { key: "cleanup", label: "Clean Up", state: "NONE", detail: "API なし。請求書CSVの取込と画面への導線で連携" },
  ];
}
