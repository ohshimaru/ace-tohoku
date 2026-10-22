import Link from "next/link";
import { Badge, Card, LinkButton, Notice } from "@/components/ui";
import { getDb } from "@/db";
import { addDays, addMonths, currentMonthJst, formatDate, formatDateTime, todayJst, weekdayJa } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { requireDriver } from "@/lib/session";
import { myDriverContext } from "@/server/drivers";
import { listReports, missingReports } from "@/server/reports";
import { getMyAvailability, myUpcoming } from "@/server/shifts";
import { listStatements } from "@/server/statements";

export const metadata = { title: "ホーム" };

const wd = weekdayJa;

export default async function DriverHome() {
  const actor = await requireDriver();
  const db = getDb();
  const today = todayJst();
  const cur = currentMonthJst();
  const [ctx, upcoming, missing, returned, statements, a0, a1] = await Promise.all([
    myDriverContext(db, actor),
    myUpcoming(db, actor, today, addDays(today, 7)),
    missingReports(db, actor),
    listReports(db, actor, { status: "RETURNED" }),
    listStatements(db, actor),
    getMyAvailability(db, actor, cur),
    getMyAvailability(db, actor, addMonths(cur, 1)),
  ]);
  const openAvail = [a0, a1].map((a, i) => ({ a, month: addMonths(cur, i) })).filter(({ a }) => a.period?.status === "OPEN" && !a.submitted);
  const unread = statements.filter((s) => !s.s.acknowledgedAt);
  const todays = upcoming.filter((u) => u.date === today);
  return (
    <div className="space-y-5">
      <h1 className="sr-only">ホーム</h1>
      {openAvail.map(({ a, month }) => (
        <Notice key={month} tone={a.period!.deadline < new Date() ? "bad" : "warn"} title={`${month.replace("-", "年")}月の稼働希望が未提出です`}>
          <p>締切: {formatDateTime(a.period!.deadline)}{a.period!.deadline < new Date() && "（締切を過ぎています）"}</p>
          <LinkButton href={`/d/availability?month=${month}`} variant="primary" className="mt-2 min-h-12 w-full text-base">稼働希望を入力する</LinkButton>
        </Notice>
      ))}
      {!ctx.emailVerified && (
        <Notice tone="info" title="メールアドレスが未登録です">登録すると、稼働希望の締切前にお知らせが届きます。<Link className="ml-1 font-bold underline" href="/d/profile">登録する</Link></Notice>
      )}

      <Card title={`今日の予定（${formatDate(today)}）`}>
        {todays.length === 0 ? <p className="text-sm text-muted">今日の確定した予定はありません。</p> : (
          <ul className="space-y-2">
            {todays.map((u) => (
              <li key={u.id} className="rounded-md border border-line p-3">
                <p className="text-lg font-bold tabular">{u.start.slice(0, 5)}〜{u.end.slice(0, 5)}</p>
                <p>{u.projectName}{u.area && <span className="text-muted">（{u.area}）</span>}</p>
                {u.note && <p className="text-sm text-muted">{u.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(missing.length > 0 || returned.length > 0) && (
        <Card title="日報の提出が必要です">
          <ul className="divide-y divide-line">
            {returned.map((r) => (
              <li key={r.r.id} className="flex items-center justify-between gap-2 py-3">
                <div><p className="font-bold">{formatDate(r.r.workDate)}（{wd(r.r.workDate)}） {r.projectName}</p><Badge tone="warn">差戻し</Badge> <span className="text-sm text-muted">{r.r.returnReason}</span></div>
                <LinkButton href={`/d/reports/${r.r.id}`} variant="primary" className="min-h-12 shrink-0">直す</LinkButton>
              </li>
            ))}
            {missing.map((m) => (
              <li key={m.assignmentId} className="flex items-center justify-between gap-2 py-3">
                <div><p className="font-bold">{formatDate(m.workDate)}（{wd(m.workDate)}）</p><p className="text-sm">{m.projectName} {m.start.slice(0, 5)}〜{m.end.slice(0, 5)}</p><Badge tone="bad">未提出</Badge></div>
                <LinkButton href={`/d/reports/new?date=${m.workDate}&project=${m.projectId}`} variant="primary" className="min-h-12 shrink-0">書く</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="これから7日間の予定" actions={<Link href="/d/schedule" className="text-sm text-navy-700 underline">すべて見る</Link>}>
        {upcoming.filter((u) => u.date > today).length === 0 ? <p className="text-sm text-muted">確定した予定はありません。</p> : (
          <ul className="divide-y divide-line">
            {upcoming.filter((u) => u.date > today).map((u) => (
              <li key={u.id} className="py-2"><span className="font-bold">{formatDate(u.date)}（{wd(u.date)}）</span> <span className="tabular">{u.start.slice(0, 5)}〜{u.end.slice(0, 5)}</span><br /><span className="text-sm">{u.projectName}</span></li>
            ))}
          </ul>
        )}
      </Card>

      {unread.length > 0 && (
        <Card title="新しい稼働明細">
          <ul className="divide-y divide-line">
            {unread.map(({ s }) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div><p className="font-bold">{s.month.replace("-", "年")}月分{s.version > 1 && `（訂正版 第${s.version}版）`}</p><p className="tabular">お支払額 {formatYen(s.payAmount)}</p></div>
                <LinkButton href={`/d/statements/${s.id}`} variant="primary" className="min-h-12">確認する</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-center text-xs text-muted">所属: {ctx.divisionName}</p>
    </div>
  );
}
