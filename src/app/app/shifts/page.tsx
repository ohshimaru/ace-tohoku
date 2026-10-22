import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { addMonths, currentMonthJst, formatDate, formatDateTime, monthRange, MONTH_RE, weekdayJa } from "@/lib/dates";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { projectOptions } from "@/server/partners";
import { explainSlots, getBoard } from "@/server/shifts";
import { assignAction, autoAssignAction, cancelSlotAction, closePeriodAction, confirmAssignmentsAction, createSlotsAction, decideChangeAction, openPeriodAction, unassignAction } from "./actions";

export const metadata = { title: "稼働スケジュール" };
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const SUB: Record<string, [string, "ok" | "warn" | "bad"]> = { SUBMITTED: ["提出済み", "ok"], DRAFT: ["入力中", "warn"], NONE: ["未提出", "bad"] };

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ month?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const divisions = (await listDivisions(db, actor)).filter((d) => d.kind === "DRIVER");
    const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : addMonths(currentMonthJst(), 1);
    const divisionId = divisions.find((d) => d.id === sp.division)?.id ?? divisions[0]?.id;
    if (!divisionId) return <><PageHeader title="稼働スケジュール" /><EmptyState title="業務委託（ドライバー）の事業部がありません">設定 → 事業部 で作成してください。</EmptyState></>;
    const [board, explain, projects] = await Promise.all([getBoard(db, actor, month, divisionId), explainSlots(db, actor, month, divisionId), projectOptions(db, actor, divisionId)]);
    const [from, to] = monthRange(month);
    const hidden = <><input type="hidden" name="month" value={month} /><input type="hidden" name="divisionId" value={divisionId} /></>;
    const drafts = board.slots.reduce((t, s) => t + s.assignments.filter((a) => a.a.status === "DRAFT").length, 0);
    const short = board.slots.reduce((t, s) => t + Math.max(0, s.s.requiredCount - s.assignments.length), 0);
    const submitted = board.drivers.filter((d) => d.submission === "SUBMITTED").length;
    const activeDrivers = board.drivers.filter((d) => d.status === "ACTIVE");
    const xl = (scope: string, id = "") => `/api/export/schedule?month=${month}&scope=${scope}${id ? `&id=${id}` : ""}`;
    return (
      <>
        <PageHeader title="稼働スケジュール" description="①受付開始 → ②ドライバーが稼働希望を提出 → ③稼働枠を作成 → ④自動割当（下書き） → ⑤手動で調整 → ⑥確定。確定するまでドライバーには表示されません。" />
        <FilterBar>
          <Field label="対象月"><Input type="month" name="month" defaultValue={month} /></Field>
          <Field label="事業部"><Select name="division" defaultValue={divisionId}>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </FilterBar>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="① 稼働希望の受付">
            {board.period ? (
              <p className="mb-2 text-sm">状態: <Badge tone={board.period.status === "OPEN" ? "info" : "neutral"}>{board.period.status === "OPEN" ? "受付中" : "受付終了"}</Badge> 締切 {formatDateTime(board.period.deadline)}</p>
            ) : <p className="mb-2 text-sm text-muted">まだ受付を開始していません。</p>}
            <p className="mb-3 text-sm">提出 {submitted} / {activeDrivers.length}人（利用中）</p>
            <ActionForm action={openPeriodAction} submitLabel={board.period ? "締切を変更・再開" : "受付を開始"} submitVariant="secondary">
              {hidden}
              <Field label="締切" required><Input type="datetime-local" name="deadline" required defaultValue={board.period ? new Date(board.period.deadline.getTime() + 9 * 3600_000).toISOString().slice(0, 16) : `${addMonths(month, -1)}-25T18:00`} /></Field>
            </ActionForm>
            {board.period?.status === "OPEN" && <ActionForm action={closePeriodAction} submitLabel="受付を終了" submitVariant="ghost" className="mt-2">{hidden}</ActionForm>}
            <p className="mt-2 text-xs text-muted">未提出の人にだけ、メール確認済みのアドレスへリマインドが送られます（メール送信の画面でタイミングを設定）。</p>
          </Card>
          <Card title="③ 稼働枠を作成" className="lg:col-span-2">
            <ActionForm action={createSlotsAction} submitLabel="枠を作成" submitVariant="secondary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="案件" required className="col-span-2"><Select name="projectId" required><option value="">選択</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
                <Field label="開始日" required><Input type="date" name="from" min={from} max={to} defaultValue={from} required /></Field>
                <Field label="終了日"><Input type="date" name="to" min={from} max={to} defaultValue={to} /></Field>
                <Field label="開始" required><Input type="time" name="startTime" defaultValue="09:00" required /></Field>
                <Field label="終了" required><Input type="time" name="endTime" defaultValue="18:00" required /></Field>
                <Field label="必要人数" required><Input name="requiredCount" inputMode="numeric" defaultValue="1" required /></Field>
                <Field label="必要資格"><Input name="requiredQualifications" placeholder="例: 冷凍" /></Field>
                <Field label="必要車両"><Input name="requiredVehicle" placeholder="例: 軽バン" /></Field>
                <Field label="エリア"><Input name="area" /></Field>
                <Field label="メモ（ドライバーに表示）" className="col-span-2"><Input name="note" maxLength={300} /></Field>
              </div>
              <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-sm font-medium">曜日（選ばない場合は毎日）</legend>{WD.map((w, i) => <label key={i} className="flex items-center gap-1"><input type="checkbox" name="wd" value={i} defaultChecked={i >= 1 && i <= 5} className="h-4 w-4" />{w}</label>)}</fieldset>
            </ActionForm>
          </Card>
        </div>

        <Card title="④〜⑥ 割当" className="mt-6" actions={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a className="text-navy-700 underline" href={xl("division", divisionId)}>Excel（この事業部）</a>
            <a className="text-navy-700 underline" href={xl("all")}>Excel（月全体）</a>
          </div>
        }>
          <div className="mb-4 flex flex-wrap items-start gap-3">
            <ActionForm action={autoAssignAction} submitLabel="④ 自動で割当（下書き）" submitVariant="secondary">{hidden}</ActionForm>
            <ActionForm action={confirmAssignmentsAction} submitLabel={`⑥ 下書き${drafts}件を確定`} confirm={`下書きの割当${drafts}件を確定します。確定するとドライバーの予定に表示されます。よろしいですか？`}>{hidden}</ActionForm>
            <p className="text-sm">不足: <strong className={short ? "text-bad" : "text-ok"}>{short}人</strong>　下書き: {drafts}件</p>
          </div>
          <p className="mb-3 text-xs text-muted">必須条件（稼働不可・希望時間外・時間の重複・資格・車両・エリア・上限）は自動・手動とも必ず守ります。優先条件（希望案件・稼働日数の公平さ）は自動割当の並び順だけに使います。</p>
          {board.slots.length === 0 ? <EmptyState title="この月の稼働枠はありません">上の「稼働枠を作成」から作成してください。</EmptyState> : (
            <Table>
              <thead><tr><Th>日付</Th><Th>案件・時間</Th><Th>条件</Th><Th>割当</Th><Th>追加</Th><Th /></tr></thead>
              <tbody>{board.slots.map(({ s, code, projectName, assignments }) => {
                const ex = explain.get(s.id);
                const missing = s.requiredCount - assignments.length;
                return (
                  <tr key={s.id}>
                    <Td className="whitespace-nowrap">{formatDate(s.workDate)}（{weekdayJa(s.workDate)}）</Td>
                    <Td><span className="font-bold">{code}</span> {projectName}<div className="tabular text-xs">{s.startTime.slice(0, 5)}〜{s.endTime.slice(0, 5)}・{s.requiredCount}人</div></Td>
                    <Td className="text-xs">{[...s.requiredQualifications, s.requiredVehicle, s.area].filter(Boolean).join("・") || "—"}</Td>
                    <Td>
                      <ul className="space-y-1">{assignments.map(({ a, name }) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-1">
                          <span>{name}</span><Badge tone={a.status === "CONFIRMED" ? "ok" : "warn"}>{a.status === "CONFIRMED" ? "確定" : "下書き"}</Badge>
                          <ActionForm action={unassignAction} inline submitLabel="外す" submitVariant="ghost" hideMessageOnSuccess confirm={a.status === "CONFIRMED" ? undefined : "この下書きの割当を外しますか？"}>
                            {hidden}<input type="hidden" name="assignmentId" value={a.id} />
                            {a.status === "CONFIRMED" && <Input name="reason" placeholder="外す理由（必須）" className="w-36" required />}
                          </ActionForm>
                        </li>
                      ))}</ul>
                      {missing > 0 && <p className="mt-1 text-xs font-bold text-bad">不足 {missing}人{ex && ex.candidates.length === 0 && ex.reasons.length > 0 && `：${ex.reasons.slice(0, 3).map((r) => `${r.label}(${r.count})`).join("、")}`}</p>}
                    </Td>
                    <Td>
                      {missing > 0 && ex && ex.candidates.length > 0 && (
                        <ActionForm action={assignAction} inline submitLabel="割当" submitVariant="secondary">
                          {hidden}<input type="hidden" name="slotId" value={s.id} />
                          <Select name="driverId" required className="w-32"><option value="">候補 {ex.candidates.length}人</option>{ex.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                        </ActionForm>
                      )}
                    </Td>
                    <Td>{!assignments.some((a) => a.a.status === "CONFIRMED") && <ActionForm action={cancelSlotAction} inline submitLabel="枠を取消" submitVariant="ghost" confirm="この稼働枠を取消しますか？">{hidden}<input type="hidden" name="slotId" value={s.id} /></ActionForm>}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="ドライバーの提出状況">
            {board.drivers.length === 0 ? <EmptyState title="ドライバーがいません" /> : (
              <Table>
                <thead><tr><Th>氏名</Th><Th>稼働希望</Th><Th>割当日数</Th><Th /></tr></thead>
                <tbody>{board.drivers.map((d) => (
                  <tr key={d.userId}>
                    <Td>{d.name}{d.status !== "ACTIVE" && <span className="ml-1 text-xs text-muted">（利用中でない）</span>}</Td>
                    <Td><Badge tone={SUB[d.submission][1]}>{SUB[d.submission][0]}</Badge></Td>
                    <Td className="tabular">{d.days}日{d.maxDaysPerMonth ? ` / 上限${d.maxDaysPerMonth}` : ""}</Td>
                    <Td><a className="text-xs text-navy-700 underline" href={xl("driver", d.userId)}>Excel</a></Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
          <Card title="稼働希望の変更申請">
            {board.changeRequests.length === 0 ? <EmptyState title="承認待ちの変更申請はありません" /> : (
              <ul className="divide-y divide-line text-sm">
                {board.changeRequests.map(({ r, name }) => (
                  <li key={r.id} className="py-2">
                    <p><strong>{name}</strong> {formatDate(r.workDate)} → {r.kind === "AVAILABLE" ? "可能" : r.kind === "UNAVAILABLE" ? "不可" : `時間指定 ${r.startTime?.slice(0, 5)}〜${r.endTime?.slice(0, 5)}`}</p>
                    <p className="text-muted">{r.reason}</p>
                    <div className="mt-1 flex gap-2">
                      <ActionForm action={decideChangeAction} inline submitLabel="承認" submitVariant="secondary">{hidden}<input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                      <ActionForm action={decideChangeAction} inline submitLabel="却下" submitVariant="ghost">{hidden}<input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /></ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Notice tone="info">承認すると稼働希望が更新されます。既存の割当と矛盾する場合は、先に割当を外す必要があります。</Notice>
          </Card>
        </div>
      </>
    );
  });
}
