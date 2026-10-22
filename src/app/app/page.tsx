import Link from "next/link";
import { ActionCardList } from "@/components/action-cards";
import { ConnBadge } from "@/components/conn-badge";
import { Bar, Metric } from "@/components/metric";
import { PeriodFilter } from "@/components/period-filter";
import { Badge, Card, EmptyState, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can, isCompanyWide } from "@/lib/access";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { periodFromParams, periodLabel, qs } from "@/lib/period";
import { requireStaff } from "@/lib/session";
import { listActionCards, refreshIfStale } from "@/server/actions-engine";
import { GettingStarted } from "@/components/getting-started";
import { guideSteps } from "@/lib/guide";
import { listBudgetStatus } from "@/server/budget";
import { listDivisions } from "@/server/masters";
import { getCashPosition, getPL, getReceivables, getWorkQueue } from "@/server/metrics";

export const metadata = { title: "ダッシュボード" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    await refreshIfStale(db);
    const divisions = await listDivisions(db, actor);
    const p = periodFromParams(sp);
    const divisionId = p.divisionId ?? (isCompanyWide(actor) ? undefined : divisions[0]?.id);
    const f = { from: p.from, to: p.to, divisionId };
    const [pl, queue, recv, budget, cards, cash] = await Promise.all([
      getPL(db, actor, f),
      getWorkQueue(db, actor),
      getReceivables(db, actor),
      listBudgetStatus(db, actor, p.to),
      listActionCards(db, actor, { status: "active", divisionId, limit: 6 }),
      can.viewBank(actor) ? getCashPosition(db, actor) : Promise.resolve(null),
    ]);
    const t = pl.totals;
    const q = qs({ from: f.from, to: f.to, division: divisionId });
    const envs = budget.filter((e) => !divisionId || e.rule.divisionId === divisionId);
    const scopeName = divisionId ? divisions.find((d) => d.id === divisionId)?.name : "会社全体";
    return (
      <>
        <PageHeader title="経営ダッシュボード" description={`${scopeName}／${periodLabel(f.from, f.to)}`} />
        <GettingStarted steps={guideSteps(actor.role, { hasDriverDivision: divisions.some((d) => d.kind === "DRIVER") })} demo={actor.demo} />
        <PeriodFilter from={f.from} to={f.to} divisionId={divisionId} divisions={divisions} />

        <Card title="AIからの対応指示" actions={<Link className="text-sm text-navy-700 underline" href="/app/actions">すべて見る</Link>} className="mb-6">
          <ActionCardList cards={cards} compact />
          <p className="mt-3 text-xs text-muted">数値の計算と異常の検知はアプリのルールで行っています。税務上の判断が必要なものは「要確認」と表示し、自動で支払い・契約・予算変更は行いません。</p>
        </Card>

        <h2 className="mb-2 text-sm font-bold text-navy-800">損益（税抜・{periodLabel(f.from, f.to)}）</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="売上" value={t.sales} href={`/app/pl/drill${qs({ kind: "sales", from: f.from, to: f.to, division: divisionId })}`} />
          <Metric label="直接経費" value={t.directCost} href={`/app/pl${q}`} note="承認済み経費＋確定した稼働明細" />
          <Metric
            label={pl.companyWide ? "共通経費（全社）" : "共通経費（配賦額）"}
            value={pl.companyWide ? t.commonTotal : t.allocatedCommon}
            note={pl.companyWide && t.unallocatedCommon ? `うち未配賦 ${formatYen(t.unallocatedCommon)}` : "配賦ルールで按分"}
          />
          <Metric label={pl.companyWide ? "利益（共通経費控除後）" : "配賦後利益"} value={t.profit} note={t.margin === null ? "売上なし" : `利益率 ${Math.round(t.margin * 1000) / 10}%`} />
        </div>

        {pl.rows.length > 1 && (
          <Card title="事業部別" className="mt-4">
            <Table>
              <thead><tr><Th>事業部</Th><Th className="text-right">売上</Th><Th className="text-right">直接経費</Th><Th className="text-right">配賦額</Th><Th className="text-right">配賦後利益</Th><Th className="text-right">利益率</Th><Th className="text-right">外注費率</Th></tr></thead>
              <tbody>
                {pl.rows.map((r) => (
                  <tr key={r.divisionId}>
                    <Td><Link className="text-navy-700 hover:underline" href={`/app/divisions/${r.divisionId}${qs({ from: f.from, to: f.to })}`}>{r.name}</Link></Td>
                    <Td className="tabular text-right">{formatYen(r.sales)}</Td>
                    <Td className="tabular text-right">{formatYen(r.directCost)}</Td>
                    <Td className="tabular text-right">{formatYen(r.allocatedCommon)}</Td>
                    <Td className={`tabular text-right ${r.profit < 0 ? "text-bad" : ""}`}>{formatYen(r.profit)}</Td>
                    <Td className="tabular text-right">{r.margin === null ? "—" : `${Math.round(r.margin * 1000) / 10}%`}</Td>
                    <Td className="tabular text-right">{r.outsourcingRatio === null ? "—" : `${Math.round(r.outsourcingRatio * 1000) / 10}%`}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title={`予算（社内ルール上使える額・${p.to}）`} actions={<Link className="text-sm text-navy-700 underline" href={`/app/budget?month=${p.to}`}>詳細と計算根拠</Link>}>
            {envs.length === 0 ? (
              <EmptyState title="予算ルールが設定されていません">{can.editBudgetRules(actor) ? "「予算」画面でルールを追加できます。" : "経営者・会社管理者が設定します。"}</EmptyState>
            ) : (
              <ul className="space-y-3">
                {envs.slice(0, 6).map((e) => (
                  <li key={e.rule.id} className="text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-bold">{e.scopeLabel}</span>
                      <span className="tabular">残り <b className={e.available < 0 ? "text-bad" : ""}>{formatYen(e.available)}</b> / 上限 {formatYen(e.cap)}</span>
                    </div>
                    <Bar value={e.used + e.reserved} max={e.cap} tone={e.available < 0 ? "bad" : (e.consumptionRate ?? 0) > 0.8 ? "warn" : "navy"} />
                    <p className="mt-0.5 text-xs text-muted">使用済み {formatYen(e.used)}／予約済み {formatYen(e.reserved)}{e.forecast !== null && `／月末見込み ${formatYen(e.forecast)}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {cash ? (
            <Card title="資金（銀行残高に基づく）" actions={<Link className="text-sm text-navy-700 underline" href="/app/bank">口座と取引</Link>}>
              {!cash.hasBank ? (
                <EmptyState title="銀行口座が登録されていません">「銀行口座」画面でデモ口座を追加するか、CSVを取り込んでください。</EmptyState>
              ) : (
                <>
                  {cash.anyDemo && <div className="mb-3"><Notice tone="warn">デモ口座のデータが含まれています（実在しない口座・取引です）。</Notice></div>}
                  <div className="grid grid-cols-2 gap-3">
                    <Metric label="口座残高の合計" value={cash.bankTotal} note={`最終同期 ${formatDateTime(cash.lastSync)}`} />
                    <Metric label={`資金余力（${cash.horizonDays}日）`} value={cash.cashCapacity} tone={cash.cashCapacity < cash.warningThreshold ? "bad" : undefined} note="残高 − 支払予定 ＋ 入金予定" />
                    <Metric label={`入金予定（${cash.horizonDays}日以内）`} value={cash.receivablesDue} href="/app/sales?status=unpaid" note={cash.receivablesOverdue ? `期日超過 ${formatYen(cash.receivablesOverdue)}` : undefined} />
                    <Metric label={`支払予定（${cash.horizonDays}日以内）`} value={cash.payablesDue} href="/app/payables" note={cash.payablesOverdue ? `期日超過 ${formatYen(cash.payablesOverdue)}` : undefined} />
                  </div>
                  <p className="mt-3 text-xs text-muted">資金余力は予算（社内ルール上使える額）とは別の指標です。</p>
                </>
              )}
            </Card>
          ) : (
            <Card title="未収金">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="未収金（担当事業部）" value={recv.total} href="/app/sales?status=unpaid" />
                <Metric label="うち入金予定日超過" value={recv.overdue} tone={recv.overdue ? "bad" : undefined} />
              </div>
              <p className="mt-3 text-xs text-muted">銀行残高と会社全体の資金は、経営者・経理のみ表示されます。</p>
            </Card>
          )}
        </div>

        <Card title="対応待ち" className="mt-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="承認待ち経費" value={queue.pending_expenses} unit="count" href="/app/approvals" note={formatYen(queue.pending_amount)} />
            <Metric label="領収書未添付" value={queue.no_receipt} unit="count" href="/app/expenses?noReceipt=1" tone={queue.no_receipt ? "warn" : undefined} />
            <Metric label="承認待ち日報" value={queue.pending_reports} unit="count" href="/app/reports?status=SUBMITTED" />
            <Metric label="未提出の日報" value={queue.missing_reports} unit="count" href="/app/reports?missing=1" tone={queue.missing_reports ? "warn" : undefined} note="確定スケジュールのうち直近31日" />
            <Metric label="未確定の稼働明細" value={queue.draft_statements} unit="count" href="/app/statements" />
            <Metric label="予算追加申請" value={queue.pending_budget_requests} unit="count" href="/app/budget" />
          </div>
          {queue.availability.length > 0 && (
            <ul className="mt-3 text-sm">
              {queue.availability.map((a) => (
                <li key={a.month}>
                  稼働希望 {a.month}：未提出 <b>{a.unsubmitted}人</b>（締切 {formatDateTime(a.deadline)}）　<Link className="text-navy-700 underline" href={`/app/shifts?month=${a.month}`}>提出状況</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="mt-4 text-xs text-muted">集計: 売上は計上月、経費は利用月の承認済み分（税抜）。請求・入金と売上、経費と支払は別に管理しています。最終更新 {formatDateTime(new Date())}。</p>
        {can.administer(actor) && <ConnectionsSummary />}
      </>
    );
  });
}

async function ConnectionsSummary() {
  const { connectionStatus } = await import("@/server/integrations");
  const list = await connectionStatus(getDb());
  return (
    <Card title="外部接続の状態" className="mt-6">
      <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        {list.map((c) => (
          <li key={c.key} className="flex items-start gap-2"><ConnBadge state={c.state} /><span><b>{c.label}</b>：{c.detail}</span></li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">「デモ」「未接続」の機能は、実際の外部サービスとはつながっていません。<Badge>最終確認 {formatDate(new Date().toISOString().slice(0, 10))}</Badge></p>
    </Card>
  );
}
