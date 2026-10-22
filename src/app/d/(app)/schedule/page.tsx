import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { getDb } from "@/db";
import { addMonths, currentMonthJst, formatDate, monthRange, MONTH_RE, todayJst, weekdayJa } from "@/lib/dates";
import { requireDriver } from "@/lib/session";
import { myUpcoming } from "@/server/shifts";

export const metadata = { title: "予定" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireDriver();
  const sp = await searchParams;
  const cur = currentMonthJst();
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : cur;
  const [from, to] = monthRange(month);
  const rows = await myUpcoming(getDb(), actor, from, to);
  const today = todayJst();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">確定した予定</h1>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        {[addMonths(cur, -1), cur, addMonths(cur, 1)].map((m) => (
          <Link key={m} href={`/d/schedule?month=${m}`} aria-current={m === month ? "page" : undefined} className={m === month ? "rounded-md bg-navy-700 py-3 font-bold text-white" : "rounded-md border border-line bg-white py-3"}>{Number(m.slice(5))}月</Link>
        ))}
      </div>
      <Card title={`${month.replace("-", "年")}月（${rows.length}件）`} actions={rows.length > 0 && <a className="text-sm font-bold text-navy-700 underline" href={`/api/export/schedule?month=${month}`}>Excelで保存</a>}>
        {rows.length === 0 ? <EmptyState title="確定した予定はありません">会社側で割当が確定すると表示されます。</EmptyState> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className={r.date < today ? "py-3 text-muted" : "py-3"}>
                <p className="font-bold">{formatDate(r.date)}（{weekdayJa(r.date)}）{r.date === today && <span className="ml-2 rounded bg-navy-700 px-2 py-0.5 text-xs text-white">今日</span>}</p>
                <p className="tabular text-lg">{r.start.slice(0, 5)}〜{r.end.slice(0, 5)}</p>
                <p>{r.projectName}{r.area && `（${r.area}）`}</p>
                {r.note && <p className="text-sm text-muted">{r.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">表示されるのは確定した予定だけです。下書きの割当は表示されません。</p>
    </div>
  );
}
