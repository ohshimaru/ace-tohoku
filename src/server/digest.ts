/**
 * 毎日の要約（Slack 投稿・タスク画面で共通）
 * - 「AI社員の動き」: ルールが新しく見つけた指摘／根拠が解消して自動で閉じた指摘／人が完了・対象外にした指摘
 * - 「今日のタスク」: 未対応・対応中の指摘を期限（期限切れ・今日・今週・それ以降）と担当で整理
 * - 「昨日の業務」: 監査ログから申請・承認・入金などの件数
 * 数値はすべて保存データから計算する。外部に送るのは件数・タイトル・金額の合計まで（個人の連絡先などは送らない）
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { actionCard, appUser, auditLog, division, SELF_COMPANY_ID, slackPost } from "@/db/schema";
import { postToSlack, slackConfigured } from "@/adapters/slack";
import { type Actor, ROLE_LABELS, type Role } from "@/lib/access";
import { addDays, currentMonthJst, formatDate, todayJst } from "@/lib/dates";
import { appUrl } from "@/lib/env";
import { formatYen } from "@/lib/money";
import { getPL, getWorkQueue } from "./metrics";

const SYSTEM: Actor = { userId: "00000000-0000-0000-0000-000000000000", name: "システム", email: null, role: "OWNER", divisionIds: [], companyId: SELF_COMPANY_ID, demo: false };

export type TaskBucket = "OVERDUE" | "TODAY" | "WEEK" | "LATER";
export const BUCKET_LABEL: Record<TaskBucket, string> = { OVERDUE: "期限切れ", TODAY: "今日まで", WEEK: "今週中", LATER: "それ以降・期限なし" };

export function bucketOf(due: string | null, today: string): TaskBucket {
  if (!due) return "LATER";
  if (due < today) return "OVERDUE";
  if (due === today) return "TODAY";
  if (due <= addDays(today, 6)) return "WEEK";
  return "LATER";
}

const ACTIVITY: [string, string[]][] = [
  ["経費の申請", ["expense.submit"]],
  ["経費の承認", ["expense.approve", "expense.approve_exception"]],
  ["経費の差戻し・却下", ["expense.return", "expense.reject"]],
  ["日報の提出", ["report.submit"]],
  ["日報の承認", ["report.approve"]],
  ["売上の計上", ["sale.create", "cleanup.import"]],
  ["入金の登録", ["receipt.create"]],
  ["支払済み", ["payable.paid"]],
  ["稼働希望の提出", ["availability.submit"]],
  ["割当の確定", ["assignment.confirm"]],
  ["稼働明細の確定・公開", ["statement.confirmed", "statement.published"]],
  ["契約書の作成・更新", ["contract.create", "contract.update", "contract.revise", "contract.signed"]],
];

export async function buildDigest(db: DB, now = new Date()) {
  const today = todayJst(now);
  const since = new Date(now.getTime() - 24 * 3600_000);
  const divs = new Map((await db.select({ id: division.id, name: division.name }).from(division)).map((d) => [d.id, d.name]));
  const base = { title: actionCard.title, priority: actionCard.priority, divisionId: actionCard.divisionId, link: actionCard.link, dueDate: actionCard.dueDate, status: actionCard.status, assigneeRole: actionCard.assigneeRole, assigneeName: appUser.name, recommendation: actionCard.recommendation };
  const open = await db
    .select(base)
    .from(actionCard)
    .leftJoin(appUser, eq(appUser.id, actionCard.assigneeId))
    .where(and(inArray(actionCard.status, ["OPEN", "IN_PROGRESS"]), isNull(actionCard.resolvedAt)))
    .orderBy(actionCard.dueDate, actionCard.priority);
  const created = await db.select(base).from(actionCard).leftJoin(appUser, eq(appUser.id, actionCard.assigneeId)).where(gte(actionCard.firstSeenAt, since));
  const resolved = await db.select(base).from(actionCard).leftJoin(appUser, eq(appUser.id, actionCard.assigneeId)).where(gte(actionCard.resolvedAt, since));
  const doneLogs = await db.select({ summary: auditLog.summary, actorName: auditLog.actorName }).from(auditLog).where(and(eq(auditLog.action, "action_card.status"), gte(auditLog.at, since), sql`(${auditLog.summary} like '%DONE%' or ${auditLog.summary} like '%DISMISSED%')`));
  const counts = await db.select({ action: auditLog.action, n: sql<number>`count(*)::int` }).from(auditLog).where(gte(auditLog.at, since)).groupBy(auditLog.action);
  const byAction = new Map(counts.map((c) => [c.action, c.n]));
  const activity = ACTIVITY.map(([label, keys]) => ({ label, n: keys.reduce((s, k) => s + (byAction.get(k) ?? 0), 0) })).filter((a) => a.n > 0);
  const queue = await getWorkQueue(db, SYSTEM);
  const m = currentMonthJst(now);
  const pl = await getPL(db, SYSTEM, { from: m, to: m });
  const tasks = open.map((t) => ({ ...t, bucket: bucketOf(t.dueDate, today), owner: t.assigneeName ?? ROLE_LABELS[t.assigneeRole as Role], divisionName: t.divisionId ? (divs.get(t.divisionId) ?? "") : "全社" }));
  return { today, month: m, tasks, created, resolved, doneLogs, activity, queue, pl: pl.totals };
}

const PRI = ["", "🔴", "🟡", "⚪️"];

/** Slack 用のメッセージ（Block Kit） */
export function digestToSlack(d: Awaited<ReturnType<typeof buildDigest>>, demo: boolean) {
  const url = appUrl();
  const lines = (arr: string[], empty: string) => (arr.length ? arr.join("\n") : empty);
  const ai = [
    `🆕 新しく見つけた指摘：*${d.created.length}件*`,
    ...d.created.slice(0, 5).map((c) => `　${PRI[c.priority]} <${url}${c.link}|${c.title}>`),
    `✅ 根拠が解消して自動で閉じた：*${d.resolved.length}件*`,
    `🙋 人が完了・対象外にした：*${d.doneLogs.length}件*`,
  ];
  const order: TaskBucket[] = ["OVERDUE", "TODAY", "WEEK"];
  const taskBlocks = order.map((b) => {
    const list = d.tasks.filter((t) => t.bucket === b);
    if (!list.length) return null;
    const byOwner = new Map<string, typeof list>();
    for (const t of list) byOwner.set(t.owner, [...(byOwner.get(t.owner) ?? []), t]);
    const body = [...byOwner.entries()].map(([owner, ts]) => `*${owner}*\n${ts.slice(0, 6).map((t) => `${PRI[t.priority]} <${url}${t.link}|${t.title}>${t.dueDate ? `（期限 ${formatDate(t.dueDate)}）` : ""}${t.status === "IN_PROGRESS" ? " _対応中_" : ""}`).join("\n")}${ts.length > 6 ? `\n…ほか${ts.length - 6}件` : ""}`).join("\n");
    return { type: "section", text: { type: "mrkdwn", text: `*${b === "OVERDUE" ? "⚠️ " : ""}${BUCKET_LABEL[b]}（${list.length}件）*\n${body}`.slice(0, 2900) } };
  }).filter(Boolean);
  const later = d.tasks.filter((t) => t.bucket === "LATER").length;
  const q = d.queue;
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `経営ナビ 毎日の要約（${formatDate(d.today)}）${demo ? "［デモ］" : ""}` } },
    { type: "section", text: { type: "mrkdwn", text: `*今月（${d.month}）* 売上 ${formatYen(d.pl.sales)}／利益 ${formatYen(d.pl.profit)}\n承認待ち：経費 ${q.pending_expenses}件・日報 ${q.pending_reports}件・予算申請 ${q.pending_budget_requests}件　未提出の日報 ${q.missing_reports}件` } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*🤖 AI社員の動き（直近24時間）*\n${lines(ai, "")}` } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*📋 今日のタスク（未対応 ${d.tasks.length}件）*${d.tasks.length === 0 ? "\n対応が必要なものはありません 🎉" : ""}` } },
    ...taskBlocks,
    ...(later ? [{ type: "context", elements: [{ type: "mrkdwn", text: `ほかに期限が先・期限なしのタスクが ${later}件あります` }] }] : []),
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*📈 昨日の業務の動き*\n${lines(d.activity.map((a) => `・${a.label}：${a.n}件`), "記録された操作はありません")}` } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "タスクを開く" }, url: `${url}/app/tasks` }, { type: "button", text: { type: "plain_text", text: "ダッシュボード" }, url: `${url}/app` }] },
    { type: "context", elements: [{ type: "mrkdwn", text: "数値はアプリのルールで計算しています。支払い・契約・予算変更は自動で行いません。" }] },
  ];
  return { text: `経営ナビ 毎日の要約（${d.today}）：未対応タスク ${d.tasks.length}件・新しい指摘 ${d.created.length}件`, blocks };
}

/**
 * 毎日の要約を Slack に送る（1日1回。失敗したら同じ日のうちは再試行できる）
 * kind=TEST は経営者が画面から送る確認用（何度でも送れるが1分に1回まで）
 */
export async function sendDailyDigest(db: DB, opts: { now?: Date; test?: boolean } = {}) {
  const now = opts.now ?? new Date();
  if (!slackConfigured()) return { status: "NOT_CONFIGURED" as const };
  const key = opts.test ? `digest-test:${now.toISOString().slice(0, 16)}` : `digest:${todayJst(now)}`;
  const [row] = await db
    .insert(slackPost)
    .values({ dedupeKey: key, kind: opts.test ? "TEST" : "DAILY_DIGEST" })
    .onConflictDoUpdate({ target: slackPost.dedupeKey, set: { attempts: sql`${slackPost.attempts}` }, where: sql`${slackPost.status} = 'FAILED' and ${slackPost.attempts} < 4` })
    .returning();
  if (!row) return { status: "ALREADY_SENT" as const };
  try {
    const d = await buildDigest(db, now);
    const { getSettings } = await import("./masters");
    const s = await getSettings(db);
    await postToSlack(digestToSlack(d, !!s.demoDataLoadedAt));
    await db.update(slackPost).set({ status: "SENT", sentAt: new Date(), attempts: row.attempts + 1, lastError: null, summary: `未対応 ${d.tasks.length}件・新規 ${d.created.length}件` }).where(eq(slackPost.id, row.id));
    return { status: "SENT" as const };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "送信エラー").slice(0, 200);
    await db.update(slackPost).set({ status: "FAILED", attempts: row.attempts + 1, lastError: msg }).where(eq(slackPost.id, row.id));
    return { status: "FAILED" as const, error: msg };
  }
}

export async function listSlackPosts(db: DB) {
  return db.select().from(slackPost).orderBy(sql`${slackPost.createdAt} desc`).limit(20);
}
