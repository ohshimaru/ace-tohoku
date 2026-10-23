import Link from "next/link";
import { Metric } from "@/components/metric";
import { Badge, Card, EmptyState, Field, FilterBar, Input, Notice, Select, Table, Td, Th } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import type { summarize, Totals, TxnFilter, VisibleTxn } from "@/server/finance-visibility";

type Summary = Awaited<ReturnType<typeof summarize>>;

function TotalsBlock({ title, note, t }: { title: string; note: string; t: Totals }) {
  const max = Math.max(1, ...t.months.flatMap((m) => [m.income, m.expense]));
  return (
    <Card title={title}>
      <p className="mb-3 text-xs text-muted">{note}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="入金の合計" value={t.income} />
        <Metric label="出金の合計" value={t.expense} />
        <Metric label="差引" value={t.net} />
        <Metric label="件数" value={t.count} unit="count" />
      </div>
      {t.months.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-bold text-muted">月別（入金／出金）</p>
          <ul className="space-y-1.5 text-xs">
            {t.months.map((m) => (
              <li key={m.month} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                <span className="tabular">{m.month}</span>
                <span className="space-y-0.5">
                  <span className="flex items-center gap-2"><span className="h-2 rounded bg-ok" style={{ width: `${(m.income / max) * 100}%` }} /><span className="tabular whitespace-nowrap">{formatYen(m.income)}</span></span>
                  <span className="flex items-center gap-2"><span className="h-2 rounded bg-navy-400" style={{ width: `${(m.expense / max) * 100}%` }} /><span className="tabular whitespace-nowrap">{formatYen(m.expense)}</span></span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * 本社・スタッフの入出金表示（提供者のプレビューも同じ部品）。
 * 受け取るデータは finance-visibility で権限判定済みのものだけ
 */
export function FinanceView({
  summary,
  txns,
  filter,
  accounts,
  detailHref,
  exportHref,
  compact = false,
  showFilter = true,
}: {
  summary: Summary;
  txns: VisibleTxn[] | null;
  filter: TxnFilter;
  accounts: { id: string; label: string }[];
  detailHref?: (id: string) => string;
  exportHref?: string;
  compact?: boolean;
  showFilter?: boolean;
}) {
  const { policy, published, all, balances, balanceTotal } = summary;
  return (
    <div className="space-y-4">
      {balances && (
        <Card title="実際の銀行残高">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <div key={b.account} className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{b.account}{b.isDemo && <Badge tone="warn">デモ</Badge>}</p>
                <p className="tabular text-xl font-bold text-navy-900">{b.balance == null ? "残高未取得" : formatYen(b.balance)}</p>
                <p className="text-xs text-muted">時点: {formatDateTime(b.asOf)}</p>
              </div>
            ))}
          </div>
          {balances.length > 1 && <p className="mt-2 text-sm">合計: <b className="tabular">{formatYen(balanceTotal ?? 0)}</b></p>}
        </Card>
      )}
      {published && (
        <TotalsBlock
          title="公開対象の入出金合計"
          note="公開されている取引だけの合計です。実際の銀行残高や会社全体の収支ではありません。集計対象外の取引は含みません。"
          t={published}
        />
      )}
      {all && <TotalsBlock title="全取引の集計" note="公開していない取引も含めた合計です（集計対象外の取引は含みません）。" t={all} />}
      {!policy.viewDetails ? (
        !published && !all && !balances ? <EmptyState title="表示できる入出金はありません" /> : <Notice tone="info">明細は公開されていません（集計のみ表示しています）。</Notice>
      ) : (
        <Card
          title={compact ? "公開された入出金" : "入出金（公開分）"}
          actions={exportHref && policy.canExport ? <a className="text-sm text-navy-700 underline" href={exportHref}>CSVで出力</a> : undefined}
        >
          {showFilter && (
            <FilterBar>
              <Field label="期間（から）"><Input type="date" name="from" defaultValue={filter.from ?? ""} /></Field>
              <Field label="期間（まで）"><Input type="date" name="to" defaultValue={filter.to ?? ""} /></Field>
              {accounts.length > 1 && (
                <Field label="口座"><Select name="account" defaultValue={filter.accountId ?? ""}><option value="">すべて</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></Field>
              )}
              <Field label="内容で検索"><Input name="q" defaultValue={filter.q ?? ""} maxLength={50} /></Field>
            </FilterBar>
          )}
          {!txns || txns.length === 0 ? (
            <EmptyState title="公開された入出金はありません" />
          ) : (
            <Table>
              <thead><tr><Th>日付</Th><Th>内容</Th><Th className="text-right">入金</Th><Th className="text-right">出金</Th><Th>区分</Th>{!compact && <Th>口座</Th>}</tr></thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className={t.excluded ? "text-muted" : ""}>
                    <Td>{formatDate(t.date)}</Td>
                    <Td>
                      {detailHref ? <Link className="text-navy-700 underline" href={detailHref(t.id)}>{t.description}</Link> : t.description}
                      {t.corrected && <Badge tone="warn">訂正あり</Badge>}
                      {t.excluded && <Badge>集計対象外</Badge>}
                      {t.project && <div className="text-xs text-muted">案件: {t.project}</div>}
                    </Td>
                    <Td className="tabular text-right text-ok">{t.amount > 0 ? formatYen(t.amount) : ""}</Td>
                    <Td className="tabular text-right">{t.amount < 0 ? formatYen(-t.amount) : ""}</Td>
                    <Td className="text-xs">{L.bankClass[t.classification]}</Td>
                    {!compact && <Td className="text-xs">{t.account}</Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {exportHref && policy.canExport && <p className="mt-2 text-xs text-muted">出力したCSVはお手元に残ります。あとから公開が停止されても、出力済みのファイルは回収できません。</p>}
        </Card>
      )}
    </div>
  );
}
