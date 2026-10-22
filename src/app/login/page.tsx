import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DemoLogin } from "@/components/demo-login";
import { Field, Input } from "@/components/ui";
import { getDb } from "@/db";
import { getActor } from "@/lib/session";
import { listDemoUsers } from "@/server/auth";
import { getSettings } from "@/server/masters";
import { loginAction } from "./actions";

export const metadata = { title: "ログイン" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const a = await getActor();
  if (a) redirect(a.role === "DRIVER" ? "/d" : "/app");
  const db = getDb();
  const [s, demo] = await Promise.all([getSettings(db), listDemoUsers(db)]);
  const form = (
    <ActionForm action={loginAction} submitLabel="ログイン" className="space-y-4 [&_button[type=submit]]:w-full">
      <Field label="メールアドレス"><Input type="email" name="email" autoComplete="username" required /></Field>
      <Field label="パスワード"><Input type="password" name="password" autoComplete="current-password" required /></Field>
    </ActionForm>
  );
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 px-4 py-10">
      <div className={demo.length > 0 ? "w-full max-w-3xl" : "w-full max-w-md"}>
        <div className="mb-6 text-center text-white">
          <p className="text-sm text-navy-200">{s.companyName}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-wide">{s.appName}</h1>
          <p className="mt-1 text-xs text-navy-300">{demo.length > 0 ? "体験版" : "会社側ログイン"}</p>
        </div>
        <div className="rounded-lg bg-white p-6 shadow-xl">
          {demo.length > 0 ? (
            <>
              <p className="rounded-md bg-warn-bg px-3 py-2 text-sm font-bold text-warn">体験版です。表示されるデータはすべて架空です。</p>
              <DemoLogin users={demo} />
              <details className="mt-6 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm text-navy-700">メールアドレスとパスワードでログイン</summary>
                <div className="mt-3">{form}</div>
              </details>
            </>
          ) : (
            <>
              {form}
              <p className="mt-4 text-xs text-muted">ドライバーの方は <a className="text-navy-700 underline" href="/d/login">こちら（LINEでログイン）</a></p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
