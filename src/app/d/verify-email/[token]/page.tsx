import { ActionForm } from "@/components/action-form";
import { confirmEmailAction } from "../../actions";

export const metadata = { title: "メールアドレスの確認" };

export default async function VerifyEmail({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <h1 className="text-xl font-bold text-navy-900">メールアドレスの確認</h1>
        <p className="text-sm text-muted">下のボタンを押すと、このメールアドレスがリマインドの送信先として登録されます。</p>
        <ActionForm action={confirmEmailAction} submitLabel="登録する" className="space-y-3 [&_button]:min-h-12 [&_button]:w-full">
          <input type="hidden" name="token" value={token} />
        </ActionForm>
      </div>
    </main>
  );
}
