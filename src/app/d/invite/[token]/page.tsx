import { lineConfigured } from "@/adapters/line";
import { ActionForm } from "@/components/action-form";
import { Notice } from "@/components/ui";
import { getDb } from "@/db";
import { demoLoginAllowed } from "@/server/auth";
import { peekInvite } from "@/server/drivers";
import { demoBindAction } from "../../actions";

export const metadata = { title: "招待" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? await peekInvite(getDb(), token) : null;
  const line = lineConfigured();
  const demo = demoLoginAllowed() && !line;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <h1 className="text-xl font-bold text-navy-900">ドライバー用ページへの招待</h1>
        {!inv ? (
          <Notice tone="bad" title="この招待リンクは使えません">有効期限（72時間）切れか、既に使用済みです。会社の担当者に再発行を依頼してください。</Notice>
        ) : (
          <>
            <p className="text-base">{inv.name} 様</p>
            <p className="text-sm text-muted">LINEでログインすると、このLINEアカウントがあなたのアカウントとして登録されます。登録後、会社側の承認が済むと使えるようになります。</p>
            <ul className="list-disc pl-5 text-xs text-muted">
              <li>LINEから受け取るのは利用者を識別するIDだけです（友だち・トーク・メールアドレスは取得しません）</li>
              <li>このリンクは1回だけ使えます。他の人に転送しないでください</li>
            </ul>
            {line && (
              <a href={`/api/auth/line/start?invite=${encodeURIComponent(token)}`} className="flex min-h-14 w-full items-center justify-center rounded-lg bg-[#06C755] text-lg font-bold text-white hover:brightness-95">
                LINEで連携する
              </a>
            )}
            {!line && !demo && <Notice tone="warn">LINEログインがまだ設定されていません。会社の担当者にお問い合わせください。</Notice>}
            {demo && (
              <div className="rounded-lg border-2 border-dashed border-warn/50 bg-warn-bg p-4">
                <p className="mb-2 text-sm font-bold text-warn">デモ（開発環境のみ）: LINEの代わりに模擬IDで連携</p>
                <ActionForm action={demoBindAction} submitLabel="模擬LINEで連携する" className="space-y-2 [&_button]:w-full">
                  <input type="hidden" name="token" value={token} />
                </ActionForm>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
