import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { requireDriver } from "@/lib/session";
import { listExpenses } from "@/server/expenses";

export const metadata = { title: "立替経費" };

export default async function DriverExpenses() {
  const actor = await requireDriver();
  const { rows } = await listExpenses(getDb(), actor, {});
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-navy-900">立替経費</h1><LinkButton href="/d/expenses/new" variant="primary" className="min-h-12">＋ 申請する</LinkButton></div>
      <Card>
        {rows.length === 0 ? <EmptyState title="申請はまだありません">燃料代・駐車場代などを立て替えたときに申請してください。</EmptyState> : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id}>
                <Link href={`/d/expenses/${e.id}`} className="flex items-center justify-between gap-2 py-3">
                  <div><p className="font-bold">{formatDate(e.usedOn)} {e.payee}</p><p className="text-sm text-muted">{e.categoryName}・{L.settlement[e.settlement]}{e.inStatement && "（明細に反映済み）"}</p></div>
                  <div className="text-right"><p className="tabular font-bold">{formatYen(e.amount)}</p><Badge tone={L.expenseStatus[e.status][1]}>{L.expenseStatus[e.status][0]}</Badge></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">「稼働明細で精算」を選ぶと、承認後に月の稼働明細へ1回だけ加算されます。「別に支払ってもらう」を選んだ経費は明細には入りません（二重払いの防止）。</p>
    </div>
  );
}
