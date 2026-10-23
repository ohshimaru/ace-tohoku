import { redirect } from "next/navigation";
import { lineConfigured } from "@/adapters/line";
import { DemoLogin } from "@/components/demo-login";
import { Notice } from "@/components/ui";
import { getDb } from "@/db";
import { getActor, homeFor } from "@/lib/session";
import { listDemoUsers } from "@/server/auth";
import { getSettings } from "@/server/masters";

export const metadata = { title: "ドライバーログイン" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { tone: "ok" | "warn" | "bad" | "info"; text: string }> = {
  linked: { tone: "ok", text: "LINEアカウントを連携しました。会社側の承認後にログインできるようになります。" },
  pending: { tone: "warn", text: "会社側の承認待ちです。承認されるまでお待ちください。" },
  suspended: { tone: "bad", text: "このアカウントは利用停止中です。会社の担当者にお問い合わせください。" },
  not_linked: { tone: "warn", text: "このLINEアカウントは登録されていません。会社から届いた招待リンクを開いて連携してください。" },
  invite: { tone: "bad", text: "招待リンクが無効か期限切れです。会社の担当者に再発行を依頼してください。" },
  taken: { tone: "bad", text: "このLINEアカウントは既に別の利用者に連携されています。会社の担当者にお問い合わせください。" },
  state: { tone: "warn", text: "ログインの有効時間が切れました。もう一度お試しください。" },
  canceled: { tone: "info", text: "ログインを中止しました。" },
  line_error: { tone: "bad", text: "LINEとの通信に失敗しました。時間をおいてもう一度お試しください。" },
  not_configured: { tone: "warn", text: "LINEログインはまだ設定されていません（管理者による設定が必要です）。" },
  invalid: { tone: "bad", text: "リンクが正しくありません。" },
};

export default async function DriverLogin({ searchParams }: { searchParams: Promise<{ e?: string; flash?: string }> }) {
  const a = await getActor();
  if (a) redirect(homeFor(a));
  const sp = await searchParams;
  const db = getDb();
  const [s, demo] = await Promise.all([getSettings(db), listDemoUsers(db)]);
  const m = sp.e ? MESSAGES[sp.e] : sp.flash === "logged_out" ? { tone: "ok" as const, text: "ログアウトしました" } : null;
  const line = lineConfigured();
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <p className="text-sm text-navy-200">{s.companyName}</p>
          <h1 className="mt-1 text-2xl font-bold">ドライバー用ページ</h1>
        </div>
        <div className="space-y-4 rounded-lg bg-white p-6 shadow-xl">
          {m && <Notice tone={m.tone}>{m.text}</Notice>}
          {line ? (
            <a href="/api/auth/line/start" className="flex min-h-14 w-full items-center justify-center rounded-lg bg-[#06C755] text-lg font-bold text-white hover:brightness-95">
              LINEでログイン
            </a>
          ) : (
            <Notice tone="warn" title="LINEログインは未設定です">管理者が LINE Login の設定を行うとログインできるようになります。</Notice>
          )}
          <p className="text-sm text-muted">初めての方は、会社から届いた招待リンクを開いてLINEと連携してください。名前やメールアドレスで自動的に連携されることはありません。</p>
          <DemoLogin users={demo.filter((u) => u.role === "DRIVER")} />
        </div>
        <p className="mt-4 text-center text-xs text-navy-300"><a className="underline" href="/login">会社側の方はこちら</a></p>
      </div>
    </main>
  );
}
