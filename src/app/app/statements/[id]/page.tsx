import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DefList, Field, Grid, Input, Notice, PageHeader, Table, Td, Textarea, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { getStatement } from "@/server/statements";
import { correctionAction, regenerateAction, replyAction, statementStatusAction } from "../actions";

export const metadata = { title: "稼働明細" };
const KIND: Record<string, string> = { WORK: "稼働", ADJUSTMENT: "調整", EXPENSE: "立替経費" };

export default async function StaffStatement({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const st = await getStatement(getDb(), actor, id);
    const s = st.s;
    const snap = (s.snapshot ?? {}) as { warnings?: string[]; taxMode?: string; withholdingEnabled?: boolean; withholdingNote?: string; paidOnPreviousVersions?: number; overpaid?: number };
    const acct = can.manageAccounting(actor);
    const op = (to: string, label: string, variant: "primary" | "secondary" = "secondary", confirm?: string) => (
      <ActionForm action={statementStatusAction} inline submitLabel={label} submitVariant={variant} confirm={confirm}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="to" value={to} /></ActionForm>
    );
    return (
      <>
        <PageHeader title={`${st.driverName}　${s.month.replace("-", "年")}月（第${s.version}版）`} back={{ href: `/app/statements?month=${s.month}`, label: "稼働明細一覧" }} actions={<Badge tone={L.statement[s.status][1]}>{L.statement[s.status][0]}</Badge>} />
        {snap.warnings && snap.warnings.length > 0 && <Notice tone="warn" title="明細に含めなかった日報があります">{snap.warnings.join("\n")}</Notice>}
        {s.correctionReason && <Notice tone="info" title="訂正版">{s.correctionReason}</Notice>}
        <div className="my-4 flex flex-wrap gap-2">
          {(s.status === "DRAFT" || s.status === "REVIEW") && <ActionForm action={regenerateAction} inline submitLabel="再生成" submitVariant="secondary"><input type="hidden" name="id" value={s.id} /></ActionForm>}
          {s.status === "DRAFT" && op("REVIEW", "確認中にする")}
          {s.status === "REVIEW" && op("DRAFT", "下書きに戻す")}
          {acct && (s.status === "DRAFT" || s.status === "REVIEW") && op("CONFIRMED", "確定する", "primary", "確定すると金額が固定され、支払予定が作られます。よろしいですか？")}
          {acct && s.status === "CONFIRMED" && op("PUBLISHED", "ドライバーに公開", "primary")}
          <a className="inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm" href={`/api/export/statement?id=${s.id}&format=pdf`}>PDF</a>
          <a className="inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm" href={`/api/export/statement?id=${s.id}&format=xlsx`}>Excel</a>
        </div>
        <Grid>
          <Card title="金額">
            <DefList items={[
              ["稼働分（税抜）", formatYen(s.workAmount)],
              ["調整", formatYen(s.adjustmentAmount)],
              [`消費税（${snap.taxMode === "INCLUSIVE" ? "内税" : snap.taxMode === "EXEMPT" ? "なし" : "外税"}）`, formatYen(s.taxAmount)],
              ["源泉徴収", s.withholdingAmount ? `-${formatYen(s.withholdingAmount)}（${snap.withholdingNote || "確認記録あり"}）` : "なし（確認済みの設定がないため計算していません）"],
              ["立替経費（支払のみ・外注費には含めない）", formatYen(s.expenseAmount)],
              ["支払額", <strong key="p">{formatYen(s.payAmount)}</strong>],
              ["支払予定日", formatDate(s.payDueDate)],
              ...(snap.paidOnPreviousVersions ? [["旧版で支払済み", formatYen(snap.paidOnPreviousVersions)] as [string, string]] : []),
              ...(snap.overpaid ? [["過払い（要確認）", formatYen(snap.overpaid)] as [string, string]] : []),
              ["支払予定", st.payable ? `${formatYen(st.payable.amount)}（${L.payable[st.payable.status][0]}）` : "—"],
            ]} />
          </Card>
          <Card title="事業部別の内訳（外注費）">
            <ul className="text-sm">{st.byDivision.map(([n, v]) => <li key={n} className="flex justify-between py-1"><span>{n}</span><span className="tabular">{formatYen(v)}</span></li>)}</ul>
            {st.versions.length > 1 && (
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <p className="mb-1 font-bold">版の履歴</p>
                <ul>{st.versions.map((v) => <li key={v.id}>{v.id === s.id ? <strong>第{v.version}版（表示中）</strong> : <Link className="text-navy-700 underline" href={`/app/statements/${v.id}`}>第{v.version}版</Link>} <Badge tone={L.statement[v.status][1]}>{L.statement[v.status][0]}</Badge></li>)}</ul>
              </div>
            )}
          </Card>
        </Grid>
        <Card title="明細行" className="mt-6">
          <Table>
            <thead><tr><Th>日付</Th><Th>区分</Th><Th>事業部</Th><Th>内容</Th><Th className="text-right">数量</Th><Th className="text-right">単価</Th><Th className="text-right">金額</Th></tr></thead>
            <tbody>{st.lines.map(({ l, divisionName }) => (
              <tr key={l.id}><Td>{formatDate(l.workDate)}</Td><Td>{KIND[l.kind]}</Td><Td>{divisionName}</Td><Td>{l.description}</Td><Td className="tabular text-right">{Number(l.quantity)}{l.unit}</Td><Td className="tabular text-right">{formatYen(l.unitPrice)}</Td><Td className="tabular text-right">{formatYen(l.amount)}</Td></tr>
            ))}</tbody>
          </Table>
        </Card>
        {acct && (s.status === "CONFIRMED" || s.status === "PUBLISHED") && (
          <Card title="訂正版を作成" className="mt-6">
            <p className="mb-2 text-sm text-muted">この版は「訂正済み（旧版）」として残り、同じ月の新しい版を下書きで作ります。未払いの支払予定は取消され、支払済みの額は新しい版の確定時に差し引かれます（二重払いの防止）。</p>
            <ActionForm action={correctionAction} submitLabel="訂正版を作成" submitVariant="danger" confirm="訂正版を作成しますか？">
              <input type="hidden" name="id" value={s.id} />
              <Field label="訂正理由" required><Input name="reason" required maxLength={500} /></Field>
            </ActionForm>
          </Card>
        )}
        <Card title="ドライバーからの問い合わせ" className="mt-6">
          {st.inquiries.length === 0 ? <p className="text-sm text-muted">問い合わせはありません。{s.acknowledgedAt && `本人が ${formatDateTime(s.acknowledgedAt)} に確認済み。`}</p> : (
            <ul className="space-y-3">{st.inquiries.map((q) => (
              <li key={q.id} className="rounded-md border border-line p-3 text-sm">
                <p className="text-xs text-muted">{formatDateTime(q.createdAt)}</p>
                <p>{q.body}</p>
                {q.reply ? <p className="mt-2 rounded bg-navy-50 p-2">回答: {q.reply}</p> : (
                  <ActionForm action={replyAction} submitLabel="回答" submitVariant="secondary" className="mt-2 space-y-2">
                    <input type="hidden" name="inquiryId" value={q.id} /><input type="hidden" name="statementId" value={s.id} />
                    <Textarea name="reply" rows={2} required maxLength={1000} />
                  </ActionForm>
                )}
              </li>
            ))}</ul>
          )}
        </Card>
      </>
    );
  });
}
