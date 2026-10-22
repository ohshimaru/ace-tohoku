import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { addMonths, currentMonthJst, formatDate, MONTH_RE } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { listStatements } from "@/server/statements";
import { generateAction } from "./actions";

export const metadata = { title: "稼働明細" };

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ month?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const divisions = (await listDivisions(db, actor)).filter((d) => d.kind === "DRIVER");
    const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : addMonths(currentMonthJst(), -1);
    const divisionId = divisions.find((d) => d.id === sp.division)?.id ?? divisions[0]?.id;
    const rows = await listStatements(db, actor, { month, divisionId });
    const active = rows.filter((r) => r.s.status !== "SUPERSEDED");
    const sum = active.reduce((t, r) => t + r.s.payAmount, 0);
    return (
      <>
        <PageHeader title="稼働明細" description="承認済みの日報・適用期間内の単価・承認済みの調整・明細で精算する立替経費から作成します。下書き→確認中→確定（経営者・経理）→公開。確定すると金額は固定され、支払予定が1件作られます。" actions={<LinkButton href="/app/statements/rates">単価・調整</LinkButton>} />
        <FilterBar>
          <Field label="対象月"><Input type="month" name="month" defaultValue={month} /></Field>
          <Field label="事業部"><Select name="division" defaultValue={divisionId}>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </FilterBar>
        {divisionId && (
          <Card title="明細の作成・再生成" className="mb-6">
            <ActionForm action={generateAction} submitLabel={`${month.replace("-", "年")}月の明細を作成・再生成`} submitVariant="secondary">
              <input type="hidden" name="month" value={month} /><input type="hidden" name="divisionId" value={divisionId} />
            </ActionForm>
            <p className="mt-2 text-xs text-muted">何度実行しても重複しません。下書き・確認中の明細だけを作り直し、確定済みは変更しません。</p>
          </Card>
        )}
        <Card title={`${active.length}件　支払予定合計 ${formatYen(sum)}`}>
          {rows.length === 0 ? <EmptyState title="明細はありません">日報を承認してから「明細を作成」を押してください。</EmptyState> : (
            <Table>
              <thead><tr><Th>ドライバー</Th><Th>版</Th><Th className="text-right">稼働分</Th><Th className="text-right">調整</Th><Th className="text-right">消費税</Th><Th className="text-right">源泉</Th><Th className="text-right">立替</Th><Th className="text-right">支払額</Th><Th>支払予定日</Th><Th>状態</Th></tr></thead>
              <tbody>{rows.map(({ s, driverName }) => (
                <tr key={s.id} className={s.status === "SUPERSEDED" ? "text-muted" : ""}>
                  <Td><Link className="font-bold text-navy-700 underline" href={`/app/statements/${s.id}`}>{driverName}</Link></Td>
                  <Td>第{s.version}版</Td>
                  <Td className="tabular text-right">{formatYen(s.workAmount)}</Td>
                  <Td className="tabular text-right">{formatYen(s.adjustmentAmount)}</Td>
                  <Td className="tabular text-right">{formatYen(s.taxAmount)}</Td>
                  <Td className="tabular text-right">{s.withholdingAmount ? `-${formatYen(s.withholdingAmount)}` : "—"}</Td>
                  <Td className="tabular text-right">{formatYen(s.expenseAmount)}</Td>
                  <Td className="tabular text-right font-bold">{formatYen(s.payAmount)}</Td>
                  <Td>{formatDate(s.payDueDate)}</Td>
                  <Td><Badge tone={L.statement[s.status][1]}>{L.statement[s.status][0]}</Badge>{s.acknowledgedAt && <Badge tone="ok">本人確認済み</Badge>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </>
    );
  });
}
