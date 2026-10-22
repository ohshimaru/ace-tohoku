import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Notice, Textarea } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireDriver } from "@/lib/session";
import { getStatement } from "@/server/statements";
import { acknowledgeAction, inquiryAction } from "../../../actions";

export const metadata = { title: "稼働明細" };

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDriver();
  const { id } = await params;
  return guard(async () => {
    const st = await getStatement(getDb(), actor, id);
    const s = st.s;
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-navy-900">{s.month.replace("-", "年")}月分の稼働明細{s.version > 1 && `（第${s.version}版）`}</h1>
        {s.version > 1 && <Notice tone="info" title="訂正版です">{s.correctionReason}</Notice>}
        <Card>
          <p className="text-sm text-muted">お支払額</p>
          <p className="tabular text-3xl font-bold text-navy-900">{formatYen(s.payAmount)}</p>
          <p className="text-sm">支払予定日 {formatDate(s.payDueDate)}</p>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <Row k="稼働分（税抜）" v={s.workAmount} />
            {s.adjustmentAmount !== 0 && <Row k="調整" v={s.adjustmentAmount} />}
            <Row k="消費税" v={s.taxAmount} />
            {s.withholdingAmount > 0 && <Row k="源泉徴収" v={-s.withholdingAmount} />}
            {s.expenseAmount > 0 && <Row k="立替経費" v={s.expenseAmount} />}
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a className="flex min-h-12 items-center justify-center rounded-md border border-line font-bold text-navy-800" href={`/api/export/statement?id=${s.id}&format=pdf`}>PDF</a>
            <a className="flex min-h-12 items-center justify-center rounded-md border border-line font-bold text-navy-800" href={`/api/export/statement?id=${s.id}&format=xlsx`}>Excel</a>
          </div>
        </Card>
        <Card title="内訳">
          <ul className="divide-y divide-line text-sm">
            {st.lines.map(({ l }) => (
              <li key={l.id} className="flex justify-between gap-2 py-2">
                <div>{l.workDate && <span className="font-bold">{formatDate(l.workDate)} </span>}{l.description}<span className="text-muted"> {Number(l.quantity)}{l.unit} × {formatYen(l.unitPrice)}</span></div>
                <span className="tabular shrink-0">{formatYen(l.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
        {s.acknowledgedAt ? <Notice tone="ok">{formatDateTime(s.acknowledgedAt)} に確認済み</Notice> : (
          <ActionForm action={acknowledgeAction} submitLabel="内容を確認しました" className="[&_button]:w-full">
            <input type="hidden" name="id" value={s.id} />
          </ActionForm>
        )}
        <Card title="問い合わせ">
          {st.inquiries.length > 0 && (
            <ul className="mb-4 space-y-3 text-sm">
              {st.inquiries.map((q) => (
                <li key={q.id} className="rounded-md border border-line p-3">
                  <p className="text-xs text-muted">{formatDateTime(q.createdAt)}</p>
                  <p>{q.body}</p>
                  {q.reply ? <p className="mt-2 rounded bg-navy-50 p-2"><Badge tone="ok">回答</Badge> {q.reply}</p> : <Badge tone="warn">回答待ち</Badge>}
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={inquiryAction} submitLabel="送信" resetOnSuccess className="space-y-2 [&_button[type=submit]]:w-full">
            <input type="hidden" name="id" value={s.id} />
            <Field label="内容に疑問がある場合"><Textarea name="body" rows={3} maxLength={1000} required /></Field>
          </ActionForm>
        </Card>
      </div>
    );
  });
}

function Row({ k, v }: { k: string; v: number }) {
  return <div className="flex justify-between"><dt>{k}</dt><dd className="tabular">{formatYen(v)}</dd></div>;
}
