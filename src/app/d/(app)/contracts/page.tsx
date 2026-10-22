import { Badge, Card, EmptyState } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { L } from "@/lib/labels";
import { requireDriver } from "@/lib/session";
import { listContracts } from "@/server/contracts";

export const metadata = { title: "契約書" };

export default async function DriverContracts() {
  const actor = await requireDriver();
  const rows = await listContracts(getDb(), actor);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">契約書</h1>
      <Card>
        {rows.length === 0 ? <EmptyState title="締結済みの契約書はありません" /> : (
          <ul className="divide-y divide-line">
            {rows.map(({ c }) => (
              <li key={c.id} className="py-3">
                <p className="font-bold">{c.title} <Badge tone={L.contract[c.status][1]}>{L.contract[c.status][0]}</Badge></p>
                <p className="text-sm text-muted">期間 {formatDate(c.terms.periodStart)}〜{formatDate(c.terms.periodEnd)}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a className="flex min-h-12 items-center justify-center rounded-md border border-line font-bold text-navy-800" href={`/api/export/contract?id=${c.id}`}>契約書PDF</a>
                  {c.signedFileId && <a className="flex min-h-12 items-center justify-center rounded-md border border-line font-bold text-navy-800" href={`/api/files/${c.signedFileId}`}>締結済みファイル</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
