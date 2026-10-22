import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { addMonths, currentMonthJst, formatDateTime } from "@/lib/dates";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { forbidden } from "@/lib/errors";
import { can } from "@/lib/access";
import { listMonthCloses } from "@/server/months";
import { closeMonthAction, reopenMonthAction } from "./actions";

export const metadata = { title: "月次締め" };

export default async function MonthsPage() {
  const actor = await requireStaff();
  return guard(async () => {
    if (!can.closeMonth(actor)) throw forbidden("月次締めは経営者・経理のみ操作できます");
    const rows = await listMonthCloses(getDb());
    return (
      <>
        <PageHeader title="月次締め" description="締めた月の売上・経費・入金は変更できなくなります。訂正が必要な場合は理由を記録して締めを解除し、訂正後にもう一度締めてください。" />
        <Card title="月を締める">
          <ActionForm action={closeMonthAction} inline submitLabel="この月を締める" confirm="締めますか？締めた月のデータは変更できなくなります">
            <Field label="対象月"><Input type="month" name="month" defaultValue={addMonths(currentMonthJst(), -1)} required /></Field>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">締める前に、承認待ちの経費・領収書未添付・未照合の銀行取引がないか「対応すること」で確認してください。</p>
        </Card>
        <Card title="締めの履歴" className="mt-4">
          {rows.length === 0 ? <p className="text-sm text-muted">締めた月はありません。</p> : (
            <Table>
              <thead><tr><Th>月</Th><Th>状態</Th><Th>締めた日時</Th><Th>解除の記録</Th><Th /></tr></thead>
              <tbody>{rows.map((m) => (
                <tr key={m.month}>
                  <Td className="font-bold">{m.month}</Td>
                  <Td>{m.isClosed ? <Badge tone="ok">締め済み</Badge> : <Badge tone="warn">解除中</Badge>}</Td>
                  <Td className="text-xs">{formatDateTime(m.closedAt)}</Td>
                  <Td className="text-xs">{m.reopenedAt ? `${formatDateTime(m.reopenedAt)}：${m.reopenReason}` : "—"}</Td>
                  <Td>{m.isClosed ? (
                    <ActionForm action={reopenMonthAction} inline submitLabel="締めを解除" submitVariant="danger"><input type="hidden" name="month" value={m.month} /><Input name="reason" placeholder="解除理由（訂正内容）" required className="w-56" /></ActionForm>
                  ) : (
                    <ActionForm action={closeMonthAction} inline submitLabel="もう一度締める" submitVariant="secondary"><input type="hidden" name="month" value={m.month} /></ActionForm>
                  )}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </>
    );
  });
}
