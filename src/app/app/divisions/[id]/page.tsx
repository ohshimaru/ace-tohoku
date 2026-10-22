import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionCardList } from "@/components/action-cards";
import { Metric } from "@/components/metric";
import { PeriodFilter } from "@/components/period-filter";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { canAccessDivision } from "@/lib/access";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { periodFromParams, periodLabel, qs } from "@/lib/period";
import { requireStaff } from "@/lib/session";
import { listActionCards } from "@/server/actions-engine";
import { getSettings, listDivisions } from "@/server/masters";
import { getPL, getProjectPL, getTrend } from "@/server/metrics";
import { missingReports, pendingReportsForApprover } from "@/server/reports";

export const metadata = { title: "事業部" };
const pc = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);

export default async function DivisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const divisions = await listDivisions(db, actor);
    const d = divisions.find((x) => x.id === id);
    if (!d || !canAccessDivision(actor, id)) notFound();
    const p = periodFromParams(sp);
    const f = { from: p.from, to: p.to, divisionId: id };
    const [pl, projects, trend, cards, s] = await Promise.all([getPL(db, actor, f), getProjectPL(db, actor, f), getTrend(db, actor, p.to, 6, id), listActionCards(db, actor, { status: "active", divisionId: id, limit: 5 }), getSettings(db)]);
    const r = pl.rows.find((x) => x.divisionId === id);
    const myCards = cards;
    const drv = d.kind === "DRIVER" ? await Promise.all([missingReports(db, actor), pendingReportsForApprover(db, actor)]) : null;
    return (
      <>
        <PageHeader title={d.name} back={{ href: "/app/divisions", label: "事業部一覧" }} description={`${periodLabel(f.from, f.to)}／税抜`} actions={<Badge>{L.divisionKind[d.kind]}</Badge>} />
        <PeriodFilter from={f.from} to={f.to} divisions={[]} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="売上" value={r?.sales ?? 0} href={`/app/pl/drill${qs({ kind: "sales", from: f.from, to: f.to, division: id })}`} />
          <Metric label="直接経費" value={r?.directExpenses ?? 0} href={`/app/pl/drill${qs({ kind: "directExpenses", from: f.from, to: f.to, division: id })}`} />
          <Metric label="稼働明細（外注）" value={r?.statementCost ?? 0} />
          <Metric label="共通経費配賦" value={r?.allocatedCommon ?? 0} />
          <Metric label="配賦後利益" value={r?.profit ?? 0} note={`利益率 ${pc(r?.margin ?? null)}`} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="この事業部の画面" className="lg:col-span-1">
            <div className="grid gap-2">
              <LinkButton href={`/app/projects?division=${id}`}>案件</LinkButton>
              <LinkButton href={`/app/sales?division=${id}`}>売上・入金</LinkButton>
              <LinkButton href={`/app/expenses?division=${id}`}>経費</LinkButton>
              {d.kind === "DRIVER" && <>
                <LinkButton href={`/app/drivers?division=${id}`}>ドライバー</LinkButton>
                <LinkButton href={`/app/shifts?division=${id}`}>稼働スケジュール</LinkButton>
                <LinkButton href={`/app/reports?division=${id}`}>日報</LinkButton>
                <LinkButton href={`/app/statements?division=${id}`}>稼働明細</LinkButton>
              </>}
              {d.kind === "CLEANING" && <>
                <LinkButton href="/app/cleanup">Clean Up連携（請求書CSV取込）</LinkButton>
                {s.cleanupUrl && <a className="inline-flex min-h-10 items-center justify-center rounded-md border border-line px-4 text-sm" href={s.cleanupUrl} target="_blank" rel="noopener noreferrer">Clean Up を開く ↗</a>}
              </>}
            </div>
            {drv && <p className="mt-3 text-sm">日報の未提出 <strong>{drv[0].length}</strong>件／承認待ち <strong>{drv[1].filter((x) => x.divisionId === id).length}</strong>件</p>}
          </Card>
          <div className="lg:col-span-2">
            <Card title="この事業部で対応すること" actions={<Link className="text-sm text-navy-700 underline" href="/app/actions">すべて</Link>}>
              {myCards.length === 0 ? <EmptyState title="対応が必要な項目はありません" /> : <ActionCardList cards={myCards} />}
            </Card>
          </div>
        </div>

        <Card title="案件別（配賦前）" className="mt-6">
          {projects.length === 0 ? <EmptyState title="期間内のデータはありません" /> : (
            <Table>
              <thead><tr><Th>案件</Th><Th className="text-right">売上</Th><Th className="text-right">経費</Th><Th className="text-right">外注（明細）</Th><Th className="text-right">利益</Th><Th className="text-right">利益率</Th></tr></thead>
              <tbody>{projects.map((x) => (
                <tr key={x.id}><Td><Link className="text-navy-700 hover:underline" href={`/app/projects/${x.id}`}>{x.code} {x.name}</Link></Td><Td className="tabular text-right">{formatYen(x.sales)}</Td><Td className="tabular text-right">{formatYen(x.expenses)}</Td><Td className="tabular text-right">{formatYen(x.statement_cost)}</Td><Td className={`tabular text-right ${x.profit < 0 ? "text-bad" : ""}`}>{formatYen(x.profit)}</Td><Td className="tabular text-right">{pc(x.sales > 0 ? x.profit / x.sales : null)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card title="月次推移" className="mt-6">
          <Table>
            <thead><tr><Th>月</Th><Th className="text-right">売上</Th><Th className="text-right">費用</Th><Th className="text-right">利益</Th></tr></thead>
            <tbody>{trend.map((t) => <tr key={t.month}><Td>{t.month}</Td><Td className="tabular text-right">{formatYen(t.sales)}</Td><Td className="tabular text-right">{formatYen(t.cost)}</Td><Td className={`tabular text-right ${t.profit < 0 ? "text-bad" : ""}`}>{formatYen(t.profit)}</Td></tr>)}</tbody>
          </Table>
        </Card>
      </>
    );
  });
}
