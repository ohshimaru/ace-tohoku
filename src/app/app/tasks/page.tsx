import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Notice, PageHeader, Select } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide, ROLE_LABELS } from "@/lib/access";
import { formatDate, formatDateTime, todayJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { slackConfigured } from "@/adapters/slack";
import { listActionCards, refreshIfStale } from "@/server/actions-engine";
import { BUCKET_LABEL, bucketOf, listSlackPosts, type TaskBucket } from "@/server/digest";
import { listSlackRequests, routineConfigured, slackCommandConfigured } from "@/server/slack-requests";
import { listStaff } from "@/server/masters";
import { assignAction, setActionStatusAction, testSlackAction } from "../actions/actions";

export const metadata = { title: "タスク" };
const ORDER: TaskBucket[] = ["OVERDUE", "TODAY", "WEEK", "LATER"];
const TONE: Record<TaskBucket, "bad" | "warn" | "info" | "neutral"> = { OVERDUE: "bad", TODAY: "warn", WEEK: "info", LATER: "neutral" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    await refreshIfStale(db);
    const owner = actor.role === "OWNER";
    const [cards, staff, posts, reqs] = await Promise.all([listActionCards(db, actor, { status: "active" }), owner ? listStaff(db, actor) : Promise.resolve([]), owner ? listSlackPosts(db) : Promise.resolve([]), owner ? listSlackRequests(db) : Promise.resolve([])]);
    const today = todayJst();
    const mine = sp.who === "me";
    const rows = cards.filter(({ c }) => !mine || c.assigneeId === actor.userId || (!c.assigneeId && c.assigneeRole === actor.role));
    const groups = ORDER.map((b) => ({ b, list: rows.filter(({ c }) => bucketOf(c.dueDate, today) === b) }));
    const staffOpts = staff.filter((u) => u.status === "ACTIVE");
    return (
      <>
        <PageHeader title="タスク" description="AIが見つけた「やるべきこと」を期限ごとに整理しています。担当者を決め、対応したら「完了」にしてください。根拠が解消されると自動で消えます。" />
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link href="/app/tasks" aria-current={!mine ? "page" : undefined} className={!mine ? "rounded-md bg-navy-700 px-3 py-2 font-bold text-white" : "rounded-md border border-line bg-white px-3 py-2"}>すべて（{cards.length}）</Link>
          <Link href="/app/tasks?who=me" aria-current={mine ? "page" : undefined} className={mine ? "rounded-md bg-navy-700 px-3 py-2 font-bold text-white" : "rounded-md border border-line bg-white px-3 py-2"}>自分の担当</Link>
        </div>
        {rows.length === 0 && <EmptyState title="対応が必要なタスクはありません">新しい指摘が出るとここに表示されます。</EmptyState>}
        <div className="space-y-6">
          {groups.filter((g) => g.list.length).map(({ b, list }) => (
            <Card key={b} title={<span className="flex items-center gap-2"><Badge tone={TONE[b]}>{BUCKET_LABEL[b]}</Badge>{list.length}件</span>}>
              <ul className="divide-y divide-line">
                {list.map(({ c, assigneeName }) => (
                  <li key={c.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge tone={L.priority[c.priority][1]}>優先度 {L.priority[c.priority][0]}</Badge>
                        <Link href={c.link} className="font-bold text-navy-900 hover:underline">{c.title}</Link>
                        {c.status === "IN_PROGRESS" && <Badge tone="warn">対応中</Badge>}
                        {c.needsTaxReview && <Badge tone="warn">税務は要確認</Badge>}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">次にやること：{c.recommendation}</p>
                      <p className="mt-0.5 text-xs text-muted">期限 {c.dueDate ? formatDate(c.dueDate) : "なし"}・担当 {assigneeName ?? `${ROLE_LABELS[c.assigneeRole]}（未定）`}</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {staffOpts.length > 0 && (
                        <ActionForm action={assignAction} inline submitLabel="担当を決める" submitVariant="ghost" hideMessageOnSuccess>
                          <input type="hidden" name="id" value={c.id} />
                          <Select name="userId" defaultValue={c.assigneeId ?? ""} aria-label="担当者" className="w-36"><option value="">未定</option>{staffOpts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                        </ActionForm>
                      )}
                      {c.status === "OPEN" && <Status id={c.id} status="IN_PROGRESS" label="対応中にする" />}
                      <Status id={c.id} status="DONE" label="完了" />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        {actor.role === "OWNER" && (
          <Card title="Slack への毎日の要約" className="mt-8">
            {slackConfigured() ? (
              <Notice tone="ok">毎朝9時（日本時間）に、AI社員の動き・今日のタスク・昨日の業務の動きを Slack に送ります。</Notice>
            ) : (
              <Notice tone="warn" title="Slack の送信先が未設定です">Vercel の環境変数に SLACK_WEBHOOK_URL（Slack で作成した Incoming Webhook の URL）と CRON_SECRET を設定すると、毎朝自動で送られます。</Notice>
            )}
            <div className="mt-3"><ActionForm action={testSlackAction} submitLabel="今すぐ Slack に送ってみる" submitVariant="secondary" /></div>
            {posts.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">
                {posts.map((p) => <li key={p.id} className="py-1.5">{formatDateTime(p.createdAt)} {p.kind === "TEST" ? "テスト" : "毎日の要約"} <Badge tone={p.status === "SENT" ? "ok" : p.status === "FAILED" ? "bad" : "info"}>{p.status === "SENT" ? "送信済み" : p.status === "FAILED" ? "失敗" : "送信中"}</Badge> {p.summary}{p.lastError && <span className="text-bad"> {p.lastError}</span>}</li>)}
              </ul>
            )}
          </Card>
        )}
        {owner && (
          <Card title="Slack から Claude への依頼（/ai）" className="mt-6">
            {slackCommandConfigured() && routineConfigured() ? (
              <Notice tone="ok">Slack で <code>/ai やってほしいこと</code> と送ると、Claude が作業して結果をそのチャンネルに返します。</Notice>
            ) : (
              <Notice tone="warn" title="まだ使えません">Slack アプリ（SLACK_SIGNING_SECRET）と Claude のルーティン（ROUTINE_FIRE_URL・ROUTINE_FIRE_TOKEN）の設定が必要です。手順は docs/SLACK.md にあります。</Notice>
            )}
            {reqs.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">
                {reqs.map((r) => (
                  <li key={r.id} className="py-2">
                    <p>{formatDateTime(r.createdAt)} <b>{r.slackUserName || r.slackUserId}</b>：{r.text.slice(0, 100)} <Badge tone={r.status === "DONE" ? "ok" : r.status === "FAILED" ? "bad" : "info"}>{r.status === "DONE" ? "完了" : r.status === "FAILED" ? "失敗" : r.status === "RUNNING" ? "作業中" : "受付"}</Badge></p>
                    {r.result && <p className="mt-1 whitespace-pre-line text-muted">{r.result.slice(0, 300)}</p>}
                    {r.error && <p className="mt-1 text-bad">{r.error}</p>}
                    {r.sessionUrl && <a className="text-xs text-navy-700 underline" href={r.sessionUrl} target="_blank" rel="noopener noreferrer">作業の記録を開く ↗</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {!isCompanyWide(actor) && <p className="mt-4 text-xs text-muted">担当事業部のタスクだけ表示しています。</p>}
      </>
    );
  });
}

function Status({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={setActionStatusAction} inline submitLabel={label} submitVariant="secondary" hideMessageOnSuccess>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}
