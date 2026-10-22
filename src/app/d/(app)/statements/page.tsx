import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { requireDriver } from "@/lib/session";
import { listStatements } from "@/server/statements";

export const metadata = { title: "稼働明細" };

export default async function StatementsPage() {
  const actor = await requireDriver();
  const rows = await listStatements(getDb(), actor);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">稼働明細</h1>
      <Card>
        {rows.length === 0 ? <EmptyState title="公開された明細はまだありません">会社側で確定・公開されると表示されます。</EmptyState> : (
          <ul className="divide-y divide-line">
            {rows.map(({ s }) => (
              <li key={s.id}>
                <Link href={`/d/statements/${s.id}`} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-bold">{s.month.replace("-", "年")}月分{s.version > 1 && `（第${s.version}版）`}</p>
                    <p className="text-sm text-muted">支払予定日 {formatDate(s.payDueDate)}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-lg font-bold">{formatYen(s.payAmount)}</p>
                    {s.acknowledgedAt ? <Badge tone="ok">確認済み</Badge> : <Badge tone="warn">未確認</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
