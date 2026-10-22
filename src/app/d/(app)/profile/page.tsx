import { ActionForm } from "@/components/action-form";
import { Card, DefList, Field, Input, Notice } from "@/components/ui";
import { getDb } from "@/db";
import { requireDriver } from "@/lib/session";
import { getDriver, myDriverContext } from "@/server/drivers";
import { requestEmailAction } from "../../actions";

export const metadata = { title: "登録情報" };

export default async function ProfilePage() {
  const actor = await requireDriver();
  const db = getDb();
  const [ctx, d] = await Promise.all([myDriverContext(db, actor), getDriver(db, actor, actor.userId)]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">登録情報</h1>
      <Card title="リマインドの送信先メール">
        {ctx.email && ctx.emailVerified ? <Notice tone="ok">{ctx.email}（確認済み）</Notice> : <Notice tone="warn">メールアドレスが未登録または未確認です。登録すると稼働希望の締切前にお知らせが届きます（提出済みの場合は届きません）。</Notice>}
        <ActionForm action={requestEmailAction} submitLabel={ctx.emailVerified ? "変更する（確認メールを送信）" : "登録する（確認メールを送信）"} className="mt-3 space-y-3 [&_button[type=submit]]:w-full">
          <Field label="メールアドレス" required><Input type="email" name="email" autoComplete="email" required /></Field>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">確認メールのリンクを開くまで送信先は変わりません。LINEにメッセージは送られません。</p>
      </Card>
      <Card title="登録内容">
        <DefList items={[
          ["氏名", d.u.name],
          ["所属", ctx.divisionName],
          ["LINE連携", d.u.lineUserId ? "連携済み" : "未連携"],
          ["資格", d.d.qualifications.join("、") || "—"],
          ["車両", d.d.vehicles.join("、") || "—"],
          ["対応エリア", d.d.areas.join("、") || "—"],
        ]} />
        <p className="mt-2 text-xs text-muted">変更が必要な場合は会社の担当者にご連絡ください。</p>
      </Card>
    </div>
  );
}
