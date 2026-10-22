import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AvailabilityEditor } from "@/components/availability-editor";
import { Badge, Card, Field, Input, Notice, Select } from "@/components/ui";
import { getDb } from "@/db";
import { addDays, addMonths, currentMonthJst, formatDate, formatDateTime, monthRange, MONTH_RE, todayJst, weekdayJa } from "@/lib/dates";
import { L } from "@/lib/labels";
import { requireDriver } from "@/lib/session";
import { getMyAvailability } from "@/server/shifts";
import { requestChangeAction, saveAvailabilityAction } from "../../actions";

export const metadata = { title: "稼働希望" };

const KIND: Record<string, string> = { AVAILABLE: "○ 可能", UNAVAILABLE: "× 不可", TIME: "◐ 時間指定" };

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireDriver();
  const sp = await searchParams;
  const cur = currentMonthJst();
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : addMonths(cur, 1);
  const a = await getMyAvailability(getDb(), actor, month);
  const [from, to] = monthRange(month);
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const byDate = new Map(a.days.map((d) => [d.workDate, d]));
  const today = todayJst();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">稼働希望</h1>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        {[addMonths(cur, -1), cur, addMonths(cur, 1)].map((m) => (
          <Link key={m} href={`/d/availability?month=${m}`} aria-current={m === month ? "page" : undefined} className={m === month ? "rounded-md bg-navy-700 py-3 font-bold text-white" : "rounded-md border border-line bg-white py-3"}>
            {Number(m.slice(5))}月
          </Link>
        ))}
      </div>
      {!a.period ? (
        <Notice tone="info">{month.replace("-", "年")}月の稼働希望はまだ受付が始まっていません。</Notice>
      ) : (
        <Notice tone={a.submitted ? "ok" : a.period.deadline < new Date() ? "bad" : "warn"} title={a.submitted ? `提出済み（${formatDateTime(a.submittedAt)}）` : a.period.status === "OPEN" ? "未提出" : "受付終了"}>
          締切: {formatDateTime(a.period.deadline)}
          {!a.submitted && a.period.status === "OPEN" && a.period.deadline < new Date() && <>（締切を過ぎています。できるだけ早く提出してください）</>}
        </Notice>
      )}

      {a.period?.status === "OPEN" && !a.submitted && (
        <AvailabilityEditor
          month={month}
          dates={dates}
          initial={Object.fromEntries(a.days.map((d) => [d.workDate, { kind: d.kind, start: d.startTime?.slice(0, 5) ?? "09:00", end: d.endTime?.slice(0, 5) ?? "18:00" }]))}
          action={saveAvailabilityAction}
        />
      )}

      {a.submitted && (
        <>
          <Card title="提出した内容">
            <ul className="divide-y divide-line text-sm">
              {dates.map((d) => {
                const v = byDate.get(d);
                return (
                  <li key={d} className="flex justify-between py-2">
                    <span>{formatDate(d)}（{weekdayJa(d)}）</span>
                    <span className="font-bold">{v ? KIND[v.kind] : <span className="font-normal text-muted">未入力</span>}{v?.kind === "TIME" && ` ${v.startTime?.slice(0, 5)}〜${v.endTime?.slice(0, 5)}`}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="変更を申請する">
            <p className="mb-3 text-sm text-muted">提出後の変更は、会社側の承認で反映されます。確定済みの予定がある日は、会社に連絡のうえ申請してください。</p>
            <ActionForm action={requestChangeAction} submitLabel="変更を申請" resetOnSuccess className="space-y-3 [&_button[type=submit]]:w-full">
              <Field label="日付" required><Input type="date" name="date" min={from > today ? from : today} max={to} required /></Field>
              <Field label="変更後" required><Select name="kind" required><option value="AVAILABLE">○ 可能</option><option value="TIME">◐ 時間指定</option><option value="UNAVAILABLE">× 不可</option></Select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="開始（時間指定）"><Input type="time" name="start" /></Field><Field label="終了"><Input type="time" name="end" /></Field></div>
              <Field label="理由" required><Input name="reason" required maxLength={300} /></Field>
            </ActionForm>
          </Card>
        </>
      )}

      {a.requests.length > 0 && (
        <Card title="変更申請の履歴">
          <ul className="divide-y divide-line text-sm">
            {a.requests.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-bold">{formatDate(r.workDate)}</span> → {KIND[r.kind]}{r.kind === "TIME" && ` ${r.startTime?.slice(0, 5)}〜${r.endTime?.slice(0, 5)}`} <Badge tone={L.request[r.status][1]}>{L.request[r.status][0]}</Badge>
                <p className="text-muted">{r.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
