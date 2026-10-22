import { ActionForm } from "@/components/action-form";
import { demoLoginAction } from "@/app/login/actions";
import { ROLE_LABELS, type Role } from "@/lib/access";

const WHAT: Record<string, string> = {
  OWNER: "会社全体の売上・利益・資金、AIの対応指示、すべての設定",
  ACCOUNTING: "入金・支払・銀行照合、稼働明細の確定、月次締め",
  MANAGER: "担当事業部だけの数字・承認・スケジュール",
  DRIVER: "スマホ画面: 稼働希望の提出・予定・日報・明細",
};

/** デモログイン（開発環境・デモ環境のみ。本番ではサーバー側で拒否し、表示もしない） */
export function DemoLogin({ users }: { users: { id: string; name: string; role: string }[] }) {
  if (!users.length) return null;
  return (
    <div className="mt-6">
      <p className="text-base font-bold text-navy-900">体験する立場を選んでください</p>
      <p className="text-xs text-muted">パスワードは不要です（デモ用の架空のアカウント。実データの本番では使えません）</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {users.map((u) => (
          <ActionForm key={u.id} action={demoLoginAction} submitLabel={`${u.name}`} submitVariant="secondary" className="rounded-md border border-line p-3 [&_button]:mt-1 [&_button]:w-full [&_button]:justify-center [&_button]:font-bold">
            <input type="hidden" name="userId" value={u.id} />
            <p className="text-sm font-bold text-navy-800">{ROLE_LABELS[u.role as Role]}</p>
            <p className="text-xs text-muted">{WHAT[u.role]}</p>
          </ActionForm>
        ))}
      </div>
    </div>
  );
}
