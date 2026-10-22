import Link from "next/link";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { periodFromParams, periodLabel, qs } from "@/lib/period";
import { requireStaff } from "@/lib/session";
import { drill, DRILL, type DrillKind } from "@/server/metrics";

export const metadata = { title: "集計の明細" };

export default async function DrillPage({ searchParams }: { searchParams: Promise<{ kind?: string; from?: string; to?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const kind = (sp.kind && sp.kind in DRILL ? sp.kind : "sales") as DrillKind;
    const p = periodFromParams(sp);
    const rows = await drill(getDb(), actor, kind, p);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return (
      <>
        <PageHeader title={DRILL[kind]} back={{ href: `/app/pl${qs({ from: p.from, to: p.to, division: p.divisionId })}`, label: "損益" }} description={periodLabel(p.from, p.to)} />
        <Card title={`${rows.length}件　合計 ${formatYen(total)}`}>
          {rows.length === 0 ? <EmptyState title="明細はありません" /> : (
            <Table>
              <thead><tr><Th>日付</Th><Th>対象</Th><Th>内容</Th><Th className="text-right">金額</Th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><Td className="whitespace-nowrap">{formatDate(r.date)}</Td><Td><Link className="text-navy-700 hover:underline" href={r.href}>{r.label}</Link></Td><Td>{r.sub}</Td><Td className="tabular text-right">{formatYen(r.amount)}</Td></tr>)}</tbody>
            </Table>
          )}
          {rows.length >= 1000 && <p className="mt-2 text-xs text-warn">先頭1000件まで表示しています。期間を絞ってください。</p>}
        </Card>
      </>
    );
  });
}
