import { ActionForm } from "@/components/action-form";
import { Badge, Card, DefList, Field, Input, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide } from "@/lib/access";
import { formatDate, formatDateTime, todayJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { partnerOptions, projectOptions } from "@/server/partners";
import { getSale } from "@/server/sales";
import { addReceiptAction, cancelReceiptAction, cancelSaleAction, updateSaleAction } from "../actions";
import { SaleFields } from "../sale-fields";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getSale(db, actor, id);
    const s = x.s;
    const editable = !s.canceledAt && !s.externalSource;
    const [divisions, customers, projects] = editable ? await Promise.all([listDivisions(db, actor), partnerOptions(db, actor, "customer"), projectOptions(db, actor)]) : [[], [], []];
    return (
      <>
        <PageHeader title={s.description} back={{ href: "/app/sales", label: "売上一覧" }} description={<span className="flex flex-wrap gap-1"><Badge tone={L.billing[s.billingStatus][1]}>{L.billing[s.billingStatus][0]}</Badge>{s.canceledAt && <Badge tone="bad">取消</Badge>}{s.externalSource && <Badge tone="info">{s.externalSource === "CLEANUP" ? "Clean Up から取込" : "CSV取込"}：{s.externalId}</Badge>}</span>} />
        {s.canceledAt && <div className="mb-4"><Notice tone="bad" title="取消済み">{s.cancelReason}（{formatDateTime(s.canceledAt)}）</Notice></div>}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["売上（税抜）", s.amountExTax], ["消費税", s.taxAmount], ["入金済み", x.received], ["未収残高", x.outstanding]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-line bg-surface p-3"><p className="text-xs text-muted">{l}</p><p className="tabular text-xl font-bold">{formatYen(v as number)}</p></div>
          ))}
        </div>
        <Card title="内容">
          <DefList items={[["計上日（計上月）", `${formatDate(s.recognizedOn)}（${s.month}）`], ["事業部", x.divisionName], ["案件", x.projectCode ? `${x.projectCode} ${x.projectName}` : "—"], ["顧客", x.customerName ?? "—"], ["税区分", L.tax[s.taxRate]], ["入金予定日", formatDate(s.expectedReceiptDate)]]} />
        </Card>
        <Card title="入金" className="mt-4">
          {x.receipts.length === 0 ? <p className="text-sm text-muted">入金の記録はありません。</p> : (
            <Table>
              <thead><tr><Th>入金日</Th><Th className="text-right">金額</Th><Th>メモ</Th><Th /></tr></thead>
              <tbody>
                {x.receipts.map((r) => (
                  <tr key={r.id} className={r.canceledAt ? "text-muted line-through" : ""}>
                    <Td>{formatDate(r.receivedOn)}</Td>
                    <Td className="tabular text-right">{formatYen(r.amount)}</Td>
                    <Td>{r.note ?? ""}{r.bankTransactionId && <Badge tone="ok">銀行照合済み</Badge>}{r.canceledAt && <div className="text-xs">取消: {r.cancelReason}</div>}</Td>
                    <Td className="text-right">{isCompanyWide(actor) && !r.canceledAt && (
                      <ActionForm action={cancelReceiptAction} inline submitVariant="danger" submitLabel="取消" confirm="この入金を取消しますか？（履歴は残ります）">
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="receiptId" value={r.id} />
                        <Input name="reason" placeholder="取消理由" required className="w-36" />
                      </ActionForm>
                    )}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {isCompanyWide(actor) && !s.canceledAt && x.outstanding > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={addReceiptAction} submitLabel="入金を登録">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="入金日" required><Input type="date" name="receivedOn" defaultValue={todayJst()} max={todayJst()} required /></Field>
                  <Field label="金額（税込）" required hint={`未収残高 ${formatYen(x.outstanding)}`}><Input name="amount" defaultValue={x.outstanding} inputMode="numeric" required /></Field>
                  <Field label="メモ"><Input name="note" /></Field>
                </div>
              </ActionForm>
              <p className="mt-2 text-xs text-muted">分割入金に対応しています。銀行の取引と照合する場合は「銀行口座」画面の照合から登録すると、取引と紐付きます。</p>
            </div>
          )}
          {!isCompanyWide(actor) && <p className="mt-2 text-xs text-muted">入金の登録は経営者・経理が行います。</p>}
        </Card>
        {editable && (
          <Card title="編集" className="mt-4">
            <ActionForm action={updateSaleAction} submitLabel="保存する">
              <input type="hidden" name="id" value={s.id} />
              <SaleFields s={s} divisions={divisions} customers={customers} projects={projects} />
            </ActionForm>
            <div className="mt-6 border-t border-line pt-4">
              <ActionForm action={cancelSaleAction} inline submitVariant="danger" submitLabel="この売上を取消" confirm="取消しますか？（履歴は残ります）">
                <input type="hidden" name="id" value={s.id} />
                <Field label="取消理由"><Input name="reason" required className="w-72" /></Field>
              </ActionForm>
            </div>
          </Card>
        )}
        {s.externalSource === "CLEANUP" && <p className="mt-4 text-sm text-muted">この売上の正本は Clean Up の請求書です。修正は Clean Up で行い、請求書CSVを再取込してください。</p>}
      </>
    );
  });
}
