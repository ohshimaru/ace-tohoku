import Link from "next/link";
import { Metric } from "@/components/metric";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { currentMonthJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { getPL } from "@/server/metrics";

export const metadata = { title: "事業部" };

export default async function DivisionsPage() {
  const actor = await requireStaff();
  return guard(async () => {
    const db = getDb();
    const m = currentMonthJst();
    const [divisions, pl] = await Promise.all([listDivisions(db, actor), getPL(db, actor, { from: m, to: m })]);
    const byId = new Map(pl.rows.map((r) => [r.divisionId, r]));
    return (
      <>
        <PageHeader title="事業部" description={`${m.replace("-", "年")}月の状況（税抜・共通経費配賦後）。事業部の追加・名称変更・並び順は 設定 → 事業部 で行います。`} />
        {divisions.length === 0 ? <EmptyState title="担当の事業部がありません" /> : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {divisions.map((d) => {
              const r = byId.get(d.id);
              return (
                <Card key={d.id} title={<Link className="text-navy-800 hover:underline" href={`/app/divisions/${d.id}`}>{d.name}</Link>} actions={<Badge>{L.divisionKind[d.kind]}</Badge>}>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="売上" value={r?.sales ?? 0} />
                    <Metric label="配賦後利益" value={r?.profit ?? 0} />
                  </div>
                  <p className="mt-2 text-xs text-muted">直接費 {formatYen(r?.directCost ?? 0)}（うち稼働明細 {formatYen(r?.statementCost ?? 0)}）／共通経費配賦 {formatYen(r?.allocatedCommon ?? 0)}</p>
                </Card>
              );
            })}
          </div>
        )}
      </>
    );
  });
}
