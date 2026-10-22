import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatMinutes, weekdayJa } from "@/lib/dates";
import { L } from "@/lib/labels";
import { requireDriver } from "@/lib/session";
import { listReports, missingReports } from "@/server/reports";

export const metadata = { title: "日報" };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export default async function ReportsPage() {
  const actor = await requireDriver();
  const db = getDb();
  const [rows, missing] = await Promise.all([listReports(db, actor), missingReports(db, actor)]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-navy-900">日報</h1><LinkButton href="/d/reports/new" variant="primary" className="min-h-12">＋ 日報を書く</LinkButton></div>
      {missing.length > 0 && (
        <Card title={`未提出の日（${missing.length}日）`}>
          <ul className="divide-y divide-line">
            {missing.map((m) => (
              <li key={m.assignmentId} className="flex items-center justify-between gap-2 py-3">
                <div><p className="font-bold">{formatDate(m.workDate)}（{weekdayJa(m.workDate)}）</p><p className="text-sm">{m.projectName} {m.start.slice(0, 5)}〜{m.end.slice(0, 5)}</p></div>
                <LinkButton href={`/d/reports/new?date=${m.workDate}&project=${m.projectId}`} variant="primary" className="min-h-12 shrink-0">書く</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="これまでの日報">
        {rows.length === 0 ? <EmptyState title="日報はまだありません" /> : (
          <ul className="divide-y divide-line">
            {rows.map(({ r, projectName }) => (
              <li key={r.id}>
                <Link href={`/d/reports/${r.id}`} className="flex items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-bold">{formatDate(r.workDate)}（{weekdayJa(r.workDate)}）</p>
                    <p className="text-sm">{projectName} {r.startTime.slice(0, 5)}〜{r.endTime.slice(0, 5)}（実働 {formatMinutes(toMin(r.endTime) - toMin(r.startTime) - r.breakMinutes)}）</p>
                  </div>
                  <Badge tone={L.report[r.status][1]}>{L.report[r.status][0]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
