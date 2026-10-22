import Link from "next/link";
import { PeriodFilter } from "@/components/period-filter";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide } from "@/lib/access";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { periodFromParams, periodLabel, qs } from "@/lib/period";
import { requireStaff } from "@/lib/session";
import { listBudgetStatus } from "@/server/budget";
import { listDivisions } from "@/server/masters";
import { getPL, getProjectPL, getTrend } from "@/server/metrics";

export const metadata = { title: "損益・予実" };

const pc = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);

export default async function PLPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const divisions = await listDivisions(db, actor);
    const p = periodFromParams(sp);
    const divisionId = p.divisionId ?? (isCompanyWide(actor) ? undefined : divisions[0]?.id);
    const f = { from: p.from, to: p.to, divisionId };
    const [pl, projects, trend, budget] = await Promise.all([getPL(db, actor, f), getProjectPL(db, actor, f), getTrend(db, actor, p.to, 6, divisionId), listBudgetStatus(db, actor, p.to)]);
    const d = (kind: string, div?: string) => `/app/pl/drill${qs({ kind, from: f.from, to: f.to, division: div ?? divisionId })}`;
    const max = Math.max(1, ...trend.map((t) => Math.max(t.sales, t.cost)));
    return (
      <>
        <PageHeader title="損益・予実" description={`${periodLabel(f.from, f.to)}／税抜／共通経費は配賦ルールで按分`} />
        <PeriodFilter from={f.from} to={f.to} divisionId={divisionId} divisions={divisions} />
        <Card title="事業部別損益">
          <Table>
            <thead><tr><Th>事業部</Th><Th className="text-right">売上</Th><Th className="text-right">経費</Th><Th className="text-right">稼働明細（外注）</Th><Th className="text-right">直接経費計</Th><Th className="text-right">共通経費配賦</Th><Th className="text-right">配賦後利益</Th><Th className="text-right">利益率</Th></tr></thead>
            <tbody>
              {pl.rows.map((r) => (
                <tr key={r.divisionId}>
                  <Td><Link className="text-navy-700 hover:underline" href={`/app/divisions/${r.divisionId}${qs({ from: f.from, to: f.to })}`}>{r.name}</Link></Td>
                  <Td className="tabular text-right"><Link className="hover:underline" href={d("sales", r.divisionId)}>{formatYen(r.sales)}</Link></Td>
                  <Td className="tabular text-right"><Link className="hover:underline" href={d("directExpenses", r.divisionId)}>{formatYen(r.directExpenses)}</Link></Td>
                  <Td className="tabular text-right"><Link className="hover:underline" href={d("statementCost", r.divisionId)}>{formatYen(r.statementCost)}</Link></Td>
                  <Td className="tabular text-right">{formatYen(r.directCost)}</Td>
                  <Td className="tabular text-right">{formatYen(r.allocatedCommon)}</Td>
                  <Td className={`tabular text-right font-bold ${r.profit < 0 ? "text-bad" : ""}`}>{formatYen(r.profit)}</Td>
                  <Td className="tabular text-right">{pc(r.margin)}</Td>
                </tr>
              ))}
              {pl.companyWide && (
                <>
                  <tr className="text-muted"><Td>共通経費のうち未配賦</Td><Td colSpan={5} /><Td className="tabular text-right">{formatYen(-(pl.totals.unallocatedCommon ?? 0))}</Td><Td /></tr>
                  <tr className="font-bold"><Td>会社全体</Td><Td className="tabular text-right">{formatYen(pl.totals.sales)}</Td><Td colSpan={2} /><Td className="tabular text-right">{formatYen(pl.totals.directCost)}</Td><Td className="tabular text-right"><Link className="hover:underline" href={d("common")}>{formatYen(pl.totals.commonTotal)}</Link></Td><Td className="tabular text-right">{formatYen(pl.totals.profit)}</Td><Td className="tabular text-right">{pc(pl.totals.margin)}</Td></tr>
                </>
              )}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-muted">会社全体の利益 = 売上 − 直接経費 − 共通経費（全額を1回だけ）。共通経費は事業部へ配賦して表示しても、全社合計で二重に引かれません。数値をクリックすると明細を表示します。</p>
        </Card>

        <Card title="予実（予算と実績）" className="mt-4">
          {budget.length === 0 ? <EmptyState title="予算ルールがありません" /> : (
            <Table>
              <thead><tr><Th>予算</Th><Th>期間</Th><Th className="text-right">予算</Th><Th className="text-right">実績</Th><Th className="text-right">予約</Th><Th className="text-right">差異</Th><Th className="text-right">消化率</Th></tr></thead>
              <tbody>{budget.filter((b) => !divisionId || b.rule.divisionId === divisionId).map((b) => (
                <tr key={b.rule.id}><Td>{b.scopeLabel}</Td><Td className="text-xs">{b.periodLabel}</Td><Td className="tabular text-right">{formatYen(b.cap)}</Td><Td className="tabular text-right">{formatYen(b.used)}</Td><Td className="tabular text-right">{formatYen(b.reserved)}</Td><Td className={`tabular text-right ${b.available < 0 ? "text-bad" : ""}`}>{formatYen(b.available)}</Td><Td className="tabular text-right">{pc(b.consumptionRate)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>

        <Card title="案件別損益（配賦前）" className="mt-4">
          {projects.length === 0 ? <EmptyState title="期間内のデータはありません" /> : (
            <Table>
              <thead><tr><Th>案件</Th><Th>事業部</Th><Th className="text-right">売上</Th><Th className="text-right">経費</Th><Th className="text-right">外注（明細）</Th><Th className="text-right">利益</Th><Th className="text-right">利益率</Th></tr></thead>
              <tbody>{projects.map((r) => (
                <tr key={r.id}><Td><Link className="text-navy-700 hover:underline" href={`/app/projects/${r.id}`}>{r.code} {r.name}</Link></Td><Td className="text-xs">{r.division}</Td><Td className="tabular text-right">{formatYen(r.sales)}</Td><Td className="tabular text-right">{formatYen(r.expenses)}</Td><Td className="tabular text-right">{formatYen(r.statement_cost)}</Td><Td className={`tabular text-right ${r.profit < 0 ? "text-bad" : ""}`}>{formatYen(r.profit)}</Td><Td className="tabular text-right">{pc(r.sales > 0 ? r.profit / r.sales : null)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>

        <Card title="月次推移（直近6か月）" className="mt-4">
          <div className="flex h-40 items-end gap-3" role="img" aria-label="月次の売上と費用">
            {trend.map((t) => (
              <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end justify-center gap-1">
                  <div className="w-1/3 rounded-t bg-navy-600" style={{ height: `${(Math.max(0, t.sales) / max) * 100}%` }} title={`売上 ${formatYen(t.sales)}`} />
                  <div className="w-1/3 rounded-t bg-navy-300" style={{ height: `${(Math.max(0, t.cost) / max) * 100}%` }} title={`費用 ${formatYen(t.cost)}`} />
                </div>
                <span className="text-xs text-muted">{t.month.slice(5)}月</span>
              </div>
            ))}
          </div>
          <Table>
            <thead><tr><Th>月</Th><Th className="text-right">売上</Th><Th className="text-right">費用</Th><Th className="text-right">利益</Th></tr></thead>
            <tbody>{trend.map((t) => <tr key={t.month}><Td>{t.month}</Td><Td className="tabular text-right">{formatYen(t.sales)}</Td><Td className="tabular text-right">{formatYen(t.cost)}</Td><Td className={`tabular text-right ${t.profit < 0 ? "text-bad" : ""}`}>{formatYen(t.profit)}</Td></tr>)}</tbody>
          </Table>
        </Card>
      </>
    );
  });
}
