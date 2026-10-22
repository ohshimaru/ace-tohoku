import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, todayJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listPayables } from "@/server/sales";
import { addPayableAction, markPaidAction, reopenPayableAction } from "./actions";

export const metadata = { title: "支払予定" };

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const rows = await listPayables(getDb(), actor, { status: sp.status });
    const today = todayJst();
    const sum = rows.filter((r) => r.p.status === "SCHEDULED").reduce((s, r) => s + r.p.amount, 0);
    return (
      <>
        <PageHeader title="支払予定" description="経費・稼働明細から自動で作られる支払と、その他の支払の予定です。このシステムは送金を行いません。支払後に「支払済み」にするか、銀行取引と照合してください。" />
        <FilterBar><Field label="状況"><Select name="status" defaultValue={sp.status ?? ""}><option value="">未払い・支払済み</option><option value="SCHEDULED">未払いのみ</option><option value="PAID">支払済みのみ</option><option value="CANCELED">取消</option></Select></Field></FilterBar>
        <Card title={`未払い合計 ${formatYen(sum)}`}>
          {rows.length === 0 ? <EmptyState title="支払予定はありません" /> : (
            <Table>
              <thead><tr><Th>予定日</Th><Th>支払先</Th><Th>内容</Th><Th>元</Th><Th className="text-right">金額</Th><Th>状況</Th><Th /></tr></thead>
              <tbody>{rows.map(({ p, divisionName }) => (
                <tr key={p.id}>
                  <Td className={p.status === "SCHEDULED" && p.dueDate < today ? "font-bold text-bad" : ""}>{formatDate(p.dueDate)}</Td>
                  <Td>{p.payeeName}<div className="text-xs text-muted">{divisionName ?? ""}</div></Td>
                  <Td>{p.description}</Td>
                  <Td>{p.source === "EXPENSE" && p.sourceId ? <a className="text-navy-700 underline" href={`/app/expenses/${p.sourceId}`}>経費</a> : p.source === "STATEMENT" && p.sourceId ? <a className="text-navy-700 underline" href={`/app/statements/${p.sourceId}`}>稼働明細</a> : L.payableSource[p.source]}</Td>
                  <Td className="tabular text-right">{formatYen(p.amount)}</Td>
                  <Td><Badge tone={L.payable[p.status][1]}>{L.payable[p.status][0]}</Badge>{p.paidOn && <div className="text-xs">{formatDate(p.paidOn)}</div>}{p.bankTransactionId && <div><Badge tone="ok">銀行照合済み</Badge></div>}</Td>
                  <Td>
                    {p.status === "SCHEDULED" && <ActionForm action={markPaidAction} inline submitLabel="支払済み" submitVariant="secondary"><input type="hidden" name="id" value={p.id} /><Input type="date" name="paidOn" defaultValue={today} max={today} className="w-36" /></ActionForm>}
                    {p.status === "PAID" && !p.bankTransactionId && <ActionForm action={reopenPayableAction} inline submitLabel="未払いに戻す" submitVariant="secondary"><input type="hidden" name="id" value={p.id} /></ActionForm>}
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card title="その他の支払予定を登録" className="mt-6">
          <ActionForm action={addPayableAction} submitLabel="登録" submitVariant="secondary" resetOnSuccess>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="支払先" required><Input name="payeeName" required /></Field>
              <Field label="内容" required><Input name="description" required /></Field>
              <Field label="金額" required><Input name="amount" inputMode="numeric" required /></Field>
              <Field label="支払予定日" required><Input type="date" name="dueDate" required /></Field>
            </div>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">税金・借入の返済などの支払予定も登録できます。経費として計上されるものは「経費」から申請してください（二重計上の防止）。</p>
        </Card>
      </>
    );
  });
}
