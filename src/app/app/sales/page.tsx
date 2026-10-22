import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide } from "@/lib/access";
import { currentMonthJst, formatDate, MONTH_RE } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { qs } from "@/lib/period";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { partnerOptions, projectOptions } from "@/server/partners";
import { listSales } from "@/server/sales";
import { createSaleAction, importSalesAction } from "./actions";
import { SaleFields } from "./sale-fields";

export const metadata = { title: "売上・入金" };
type SP = Promise<{ from?: string; to?: string; division?: string; status?: string; q?: string; page?: string; project?: string }>;

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const unpaid = sp.status === "unpaid";
    const from = sp.from && MONTH_RE.test(sp.from) ? sp.from : unpaid ? undefined : currentMonthJst();
    const to = sp.to && MONTH_RE.test(sp.to) ? sp.to : from;
    const [data, divisions, customers, projects] = await Promise.all([
      listSales(db, actor, { from, to, divisionId: sp.division, status: sp.status, q: sp.q, page: sp.page, projectId: sp.project }),
      listDivisions(db, actor),
      partnerOptions(db, actor, "customer"),
      projectOptions(db, actor),
    ]);
    const p = { from, to, division: sp.division, status: sp.status, q: sp.q, project: sp.project };
    return (
      <>
        <PageHeader
          title="売上・入金"
          description="売上は計上日（計上月）で管理し、入金とは分けて記録します。"
          actions={from && <a className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-4 text-sm text-navy-800 hover:bg-navy-50" href={`/api/csv/sales${qs({ from, to })}`}>CSV出力</a>}
        />
        <FilterBar>
          <Field label="計上月（から）"><Input type="month" name="from" defaultValue={from ?? ""} /></Field>
          <Field label="（まで）"><Input type="month" name="to" defaultValue={to ?? ""} /></Field>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="状況"><Select name="status" defaultValue={sp.status ?? ""}><option value="">有効な売上</option><option value="unpaid">未入金あり</option><option value="unbilled">未請求</option><option value="canceled">取消</option></Select></Field>
          <Field label="検索"><Input name="q" defaultValue={sp.q ?? ""} placeholder="内容・顧客名" /></Field>
        </FilterBar>
        <Card title={`${data.total}件　売上合計（税抜） ${formatYen(data.sum)}`}>
          {data.rows.length === 0 ? (
            <EmptyState title="該当する売上はありません" />
          ) : (
            <Table>
              <thead><tr><Th>計上日</Th><Th>事業部・案件</Th><Th>内容・顧客</Th><Th className="text-right">税抜</Th><Th className="text-right">税込</Th><Th className="text-right">未収</Th><Th>請求</Th><Th>入金予定</Th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className={r.canceledAt ? "text-muted line-through" : "hover:bg-navy-50/50"}>
                    <Td className="whitespace-nowrap">{formatDate(r.recognizedOn)}</Td>
                    <Td>{r.divisionName}<div className="font-mono text-xs text-muted">{r.projectCode ?? ""}</div></Td>
                    <Td><Link className="text-navy-700 hover:underline" href={`/app/sales/${r.id}`}>{r.description}</Link><div className="text-xs text-muted">{r.customerName ?? ""}{r.externalSource && <span className="ml-1"><Badge tone="info">{r.externalSource === "CLEANUP" ? "Clean Up取込" : "CSV取込"}</Badge></span>}</div></Td>
                    <Td className="tabular text-right">{formatYen(r.amountExTax)}</Td>
                    <Td className="tabular text-right">{formatYen(r.gross)}</Td>
                    <Td className={`tabular text-right ${r.outstanding > 0 ? "font-bold" : "text-muted"}`}>{r.canceledAt ? "—" : formatYen(r.outstanding)}</Td>
                    <Td><Badge tone={L.billing[r.billingStatus][1]}>{L.billing[r.billingStatus][0]}</Badge></Td>
                    <Td className="whitespace-nowrap">{formatDate(r.expectedReceiptDate)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={data.page} total={data.total} limit={data.limit} params={p} />
        </Card>
        <Card title="売上を登録" className="mt-6">
          <ActionForm action={createSaleAction} submitLabel="登録する">
            <SaleFields divisions={divisions} customers={customers} projects={projects} s={{ divisionId: sp.division }} />
          </ActionForm>
        </Card>
        <Card title="CSVで取り込む" className="mt-6">
          <ActionForm action={importSalesAction} submitLabel="取り込む" submitVariant="secondary">
            <Field label="CSVファイル（UTF-8）" hint={<>見出し行が必要です。<a className="underline" href="/api/csv/sales-template">テンプレートをダウンロード</a>。1行でも誤りがあれば全件取り込みません。「外部ID」が同じ行は2回目以降スキップします。</>}>
              <Input type="file" name="file" accept=".csv,text/csv" required />
            </Field>
          </ActionForm>
          {!isCompanyWide(actor) && <p className="mt-2 text-xs text-muted">担当事業部の売上だけ取り込めます。</p>}
        </Card>
      </>
    );
  });
}
