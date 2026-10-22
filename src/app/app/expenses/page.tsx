import Link from "next/link";
import { Badge, Card, EmptyState, Field, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide } from "@/lib/access";
import { currentMonthJst, formatDate, MONTH_RE } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { qs } from "@/lib/period";
import { requireStaff } from "@/lib/session";
import { listExpenses } from "@/server/expenses";
import { listDivisions } from "@/server/masters";

export const metadata = { title: "経費" };
type SP = Promise<{ month?: string; division?: string; status?: string; q?: string; page?: string; noReceipt?: string; mine?: string; project?: string }>;

export default async function ExpensesPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : sp.noReceipt ? undefined : currentMonthJst();
    const [data, divisions] = await Promise.all([
      listExpenses(db, actor, { month, divisionId: sp.division, status: sp.status, q: sp.q, page: sp.page, noReceipt: !!sp.noReceipt, mine: sp.mine === "1", projectId: sp.project }),
      listDivisions(db, actor),
    ]);
    return (
      <>
        <PageHeader
          title="経費"
          description="承認済みの経費だけが事業部の経費・予算に反映されます。支払は「支払予定」で管理します。"
          actions={<>{month && <a className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-4 text-sm text-navy-800 hover:bg-navy-50" href={`/api/csv/expenses${qs({ from: month, to: month })}`}>CSV出力</a>}<LinkButton href="/app/expenses/new" variant="primary">＋ 経費を申請</LinkButton></>}
        />
        <FilterBar>
          <Field label="利用月"><Input type="month" name="month" defaultValue={month ?? ""} /></Field>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{isCompanyWide(actor) && <option value="COMMON">共通経費</option>}{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="状況"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option>{Object.entries(L.expenseStatus).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="領収書"><Select name="noReceipt" defaultValue={sp.noReceipt ?? ""}><option value="">すべて</option><option value="1">未添付のみ</option></Select></Field>
          <Field label="申請者"><Select name="mine" defaultValue={sp.mine ?? ""}><option value="">すべて</option><option value="1">自分の申請</option></Select></Field>
          <Field label="検索"><Input name="q" defaultValue={sp.q ?? ""} placeholder="支払先・用途" /></Field>
        </FilterBar>
        <Card title={`${data.total}件`}>
          {data.rows.length === 0 ? <EmptyState title="該当する経費はありません" /> : (
            <Table>
              <thead><tr><Th>利用日</Th><Th>事業部・費目</Th><Th>支払先・用途</Th><Th>申請者</Th><Th className="text-right">金額（税込）</Th><Th>状況</Th><Th>支払</Th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-navy-50/50">
                    <Td className="whitespace-nowrap">{formatDate(r.usedOn)}</Td>
                    <Td>{r.divisionName ?? "共通経費"}<div className="text-xs text-muted">{r.categoryName}{r.projectCode ? ` / ${r.projectCode}` : ""}</div></Td>
                    <Td><Link className="text-navy-700 hover:underline" href={`/app/expenses/${r.id}`}>{r.payee}</Link><div className="max-w-xs truncate text-xs text-muted">{r.purpose}</div>{r.fileCount === 0 && (r.status === "SUBMITTED" || r.status === "APPROVED") && <Badge tone="warn">領収書なし</Badge>}</Td>
                    <Td>{r.applicantName}</Td>
                    <Td className="tabular text-right">{formatYen(r.amount)}</Td>
                    <Td><Badge tone={L.expenseStatus[r.status][1]}>{L.expenseStatus[r.status][0]}</Badge>{r.canDecide && <div className="mt-1"><Badge tone="navy">あなたが承認できます</Badge></div>}</Td>
                    <Td className="text-xs">{r.inStatement ? "稼働明細で精算" : r.payStatus ? L.payable[r.payStatus][0] : r.status === "APPROVED" && r.settlement === "STATEMENT" ? "明細への反映待ち" : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={data.page} total={data.total} limit={data.limit} params={{ month, division: sp.division, status: sp.status, q: sp.q, noReceipt: sp.noReceipt, mine: sp.mine }} />
        </Card>
      </>
    );
  });
}
