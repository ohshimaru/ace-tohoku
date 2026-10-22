import { ActionForm } from "@/components/action-form";
import { Badge, Card, DefList, EmptyState, Field, Grid, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { getTransaction, matchCandidates } from "@/server/bank";
import { classifyAction, matchPayableAction, matchReceiptAction, receiveAction, unmatchAction } from "../actions";

export const metadata = { title: "銀行取引" };

export default async function TxnPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const [x, c] = await Promise.all([getTransaction(db, actor, id), matchCandidates(db, actor, id)]);
    const t = x.t;
    const h = <input type="hidden" name="txnId" value={t.id} />;
    return (
      <>
        <PageHeader title={`${formatDate(t.txnDate)}　${t.amount > 0 ? "入金" : "出金"} ${formatYen(Math.abs(t.amount))}`} back={{ href: "/app/bank", label: "銀行口座" }} actions={x.a.isDemo ? <Badge tone="warn">デモ</Badge> : undefined} />
        <Grid>
          <Card title="取引">
            <DefList items={[["口座", `${x.a.bankName} ${x.a.branchName} ****${x.a.accountNumberLast4}`], ["内容", t.description], ["残高", t.balanceAfter == null ? "—" : formatYen(t.balanceAfter)], ["未照合額", formatYen(x.remaining)], ["区分", L.bankClass[t.classification]], ["メモ", t.note ?? "—"]]} />
            <ActionForm action={classifyAction} submitLabel="区分を保存" submitVariant="secondary" className="mt-4 space-y-2">
              {h}
              <div className="grid grid-cols-2 gap-2">
                <Field label="区分"><Select name="classification" defaultValue={t.classification}>{Object.entries(L.bankClass).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="メモ"><Input name="note" defaultValue={t.note ?? ""} maxLength={300} /></Field>
              </div>
              <p className="text-xs text-muted">振替・借入・税金などは区分を設定すると、未照合の一覧から外れます。</p>
            </ActionForm>
          </Card>
          <Card title="照合">
            {x.matches.length === 0 ? <p className="text-sm text-muted">まだ照合されていません。</p> : (
              <ul className="space-y-2 text-sm">{x.matches.map((m) => (
                <li key={m.id} className={m.unmatched_at ? "text-muted line-through" : ""}>
                  {m.target_type === "RECEIPT" ? "入金記録" : "支払予定"}: {m.label} {formatYen(m.amount)} <span className="text-xs">（{formatDateTime(m.matched_at)}）</span>
                  {!m.unmatched_at && (
                    <ActionForm action={unmatchAction} inline submitLabel="解除" submitVariant="ghost">{h}<input type="hidden" name="matchId" value={m.id} /><Input name="reason" placeholder="解除の理由" required className="w-36" /></ActionForm>
                  )}
                </li>
              ))}</ul>
            )}
            <p className="mt-3 text-xs text-muted">支払予定に照合すると「支払済み」になります。解除すると未払いに戻ります。取引から登録した入金記録は、解除すると取消されます。</p>
          </Card>
        </Grid>
        {x.remaining > 0 && t.amount > 0 && (
          <Grid>
            <Card title="候補: 登録済みの入金記録" className="mt-6">
              {c.receipts.length === 0 ? <EmptyState title="候補はありません" /> : (
                <Table>
                  <thead><tr><Th>入金日</Th><Th>売上</Th><Th className="text-right">金額</Th><Th /></tr></thead>
                  <tbody>{c.receipts.map((r) => (
                    <tr key={r.id}><Td>{formatDate(r.received_on)}</Td><Td>{r.description}<div className="text-xs text-muted">{r.customer}</div></Td><Td className="tabular text-right">{formatYen(r.amount)}{r.amount === x.remaining && <Badge tone="ok">一致</Badge>}</Td>
                      <Td><ActionForm action={matchReceiptAction} inline submitLabel="照合" submitVariant="secondary">{h}<input type="hidden" name="receiptId" value={r.id} /></ActionForm></Td></tr>
                  ))}</tbody>
                </Table>
              )}
            </Card>
            <Card title="候補: 未収の売上（入金を登録して照合）" className="mt-6">
              {c.sales.length === 0 ? <EmptyState title="未収の売上はありません" /> : (
                <Table>
                  <thead><tr><Th>売上</Th><Th>入金予定日</Th><Th className="text-right">未収残高</Th><Th /></tr></thead>
                  <tbody>{c.sales.map((s) => (
                    <tr key={s.id}><Td>{s.description}<div className="text-xs text-muted">{s.customer} / {s.month}</div></Td><Td>{formatDate(s.expected)}</Td><Td className="tabular text-right">{formatYen(s.rest)}{s.rest === x.remaining && <Badge tone="ok">一致</Badge>}</Td>
                      <Td><ActionForm action={receiveAction} inline submitLabel="入金登録・照合" submitVariant="secondary">{h}<input type="hidden" name="saleId" value={s.id} /><Input name="amount" defaultValue={Math.min(s.rest, x.remaining)} className="w-28" inputMode="numeric" /></ActionForm></Td></tr>
                  ))}</tbody>
                </Table>
              )}
            </Card>
          </Grid>
        )}
        {x.remaining > 0 && t.amount < 0 && (
          <Card title="候補: 支払予定" className="mt-6">
            {c.payables.length === 0 ? <EmptyState title="候補はありません">支払予定に登録されていない支払は、区分（税金・借入など）を設定してください。</EmptyState> : (
              <Table>
                <thead><tr><Th>予定日</Th><Th>支払先</Th><Th>内容</Th><Th className="text-right">金額</Th><Th /></tr></thead>
                <tbody>{c.payables.map((p) => (
                  <tr key={p.id}><Td>{formatDate(p.due_date)}</Td><Td>{p.payee_name}</Td><Td>{p.description}</Td><Td className="tabular text-right">{formatYen(p.amount)}{p.amount === x.remaining && <Badge tone="ok">一致</Badge>}</Td>
                    <Td><ActionForm action={matchPayableAction} inline submitLabel="照合" submitVariant="secondary">{h}<input type="hidden" name="payableId" value={p.id} /></ActionForm></Td></tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
        )}
      </>
    );
  });
}
