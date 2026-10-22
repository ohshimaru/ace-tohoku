import { ActionForm } from "@/components/action-form";
import { demoLoginAction } from "@/app/login/actions";
import { ROLE_LABELS, type Role } from "@/lib/access";

/** 開発環境限定のデモログイン（本番ではサーバー側で拒否し、表示もしない） */
export function DemoLogin({ users }: { users: { id: string; name: string; role: string }[] }) {
  if (!users.length) return null;
  return (
    <div className="mt-6 rounded-lg border-2 border-dashed border-warn/50 bg-warn-bg p-4">
      <p className="text-sm font-bold text-warn">デモログイン（開発環境のみ・本番では使えません）</p>
      <div className="mt-3 grid gap-2">
        {users.map((u) => (
          <ActionForm key={u.id} action={demoLoginAction} submitLabel={`${u.name}（${ROLE_LABELS[u.role as Role]}）`} submitVariant="secondary" className="[&_button]:w-full [&_button]:justify-start">
            <input type="hidden" name="userId" value={u.id} />
          </ActionForm>
        ))}
      </div>
    </div>
  );
}
