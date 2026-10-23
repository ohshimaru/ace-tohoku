/**
 * 入出金の公開範囲（サーバー側で強制する唯一の判定）
 *
 * - 閲覧者（Viewer）は「サービス提供者（担当会社のみ）」「本社」「スタッフ（本人・所属事業部）」の3種類
 * - 一覧・詳細・検索・集計・残高・グラフ・件数・CSV出力はすべてこのファイルの関数を通す。
 *   非公開の取引はSQLの条件で除外し、画面（ブラウザ）には送らない
 * - 提供者のプレビューも同じ関数（previewViewer → listVisibleTxns / summarize）を使う
 * - 公開の設定は取引ごとに独立（本社公開 ≠ スタッフ公開。継承しない）。公開状態が「公開中」以外は誰にも見えない
 * - 毎回DBから判定するので、公開停止・担当解除はすぐに反映される（キャッシュしない）
 */
import { type SQL, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { type Actor, isProvider } from "@/lib/access";
import { DATE_RE } from "@/lib/dates";
import { DEFAULT_POLICY, type Policy, PROVIDER_POLICY } from "@/lib/disclosure";
import { forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { toCsv } from "./csv";

export type Viewer =
  | { kind: "PROVIDER"; companyId: string; userId: string }
  | { kind: "HQ"; companyId: string }
  | { kind: "STAFF"; companyId: string; userId: string; divisionIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** サービス提供者が担当している会社か（毎回DBで確認。担当外・存在しない会社は「見つからない」） */
export async function assertProviderCompany(db: DB, actor: Actor, companyId: string) {
  if (!isProvider(actor)) throw forbidden("サービス提供者のみ操作できます");
  if (!isUuid(companyId)) throw notFound("会社が見つかりません");
  const r = await db.execute<{ id: string; name: string; is_self: boolean; is_demo: boolean }>(sql`
    select c.id, c.name, c.is_self, c.is_demo from company c
    join provider_assignment pa on pa.company_id = c.id and pa.user_id = ${actor.userId}
    where c.id = ${companyId}`);
  if (!r.rows[0]) throw notFound("会社が見つかりません");
  return r.rows[0];
}

async function staffViewer(db: DB, userId: string, companyId: string): Promise<Viewer> {
  const r = await db.execute<{ division_id: string | null }>(sql`
    select d.division_id from app_user u left join driver d on d.user_id = u.id
    where u.id = ${userId} and u.role = 'DRIVER' and u.company_id = ${companyId}`);
  if (!r.rows[0]) throw notFound("スタッフが見つかりません");
  return { kind: "STAFF", companyId, userId, divisionIds: r.rows.map((x) => x.division_id).filter((x): x is string => !!x) };
}

/** ログイン中の利用者の閲覧者情報 */
export async function viewerFor(db: DB, actor: Actor, companyId?: string): Promise<Viewer> {
  if (isProvider(actor)) {
    if (!companyId) throw notFound("会社が見つかりません");
    await assertProviderCompany(db, actor, companyId);
    return { kind: "PROVIDER", companyId, userId: actor.userId };
  }
  if (!actor.companyId || (companyId && companyId !== actor.companyId)) throw notFound("会社が見つかりません");
  if (actor.role === "OWNER" || actor.role === "ACCOUNTING") return { kind: "HQ", companyId: actor.companyId };
  if (actor.role === "DRIVER") return staffViewer(db, actor.userId, actor.companyId);
  throw forbidden("入出金を閲覧する権限がありません");
}

/** 提供者のプレビュー用。as = "HQ" または スタッフの利用者ID。実際の閲覧と同じ Viewer を作る */
export async function previewViewer(db: DB, actor: Actor, companyId: string, as: string): Promise<Viewer> {
  await assertProviderCompany(db, actor, companyId);
  if (as === "HQ") return { kind: "HQ", companyId };
  if (!isUuid(as)) throw notFound("スタッフが見つかりません");
  return staffViewer(db, as, companyId);
}

export async function policyOf(db: DB, v: Viewer): Promise<Policy> {
  if (v.kind === "PROVIDER") return PROVIDER_POLICY;
  const subject = v.kind === "HQ" ? "HQ" : `STAFF:${v.userId}`;
  const r = await db.execute<{ view_details: boolean; view_real_balance: boolean; view_all_totals: boolean; view_published_totals: boolean; can_export: boolean }>(sql`
    select view_details, view_real_balance, view_all_totals, view_published_totals, can_export from disclosure_policy where company_id = ${v.companyId} and subject = ${subject}`);
  const p = r.rows[0];
  const base = p
    ? { viewDetails: p.view_details, viewRealBalance: p.view_real_balance, viewAllTotals: p.view_all_totals, viewPublishedTotals: p.view_published_totals, canExport: p.can_export }
    : DEFAULT_POLICY[v.kind];
  return { ...base, canExport: base.canExport && base.viewDetails };
}

/**
 * 閲覧できる取引の条件（別名 t = bank_transaction, a = bank_account）
 * ここ以外で本社・スタッフ向けの取引の条件を書かないこと
 */
export function visibleCond(v: Viewer): SQL {
  const company = sql`a.company_id = ${v.companyId}`;
  if (v.kind === "PROVIDER") return company;
  const published = sql`${company} and a.archived_at is null and t.publish_status = 'PUBLISHED'`;
  if (v.kind === "HQ") return sql`(${published} and t.hq_visible)`;
  const divs = v.divisionIds.length ? sql`or (x.kind = 'DIVISION' and x.target_id in (${sql.join(v.divisionIds.map((d) => sql`${d}::uuid`), sql`, `)}))` : sql``;
  return sql`(${published} and t.staff_visible and exists (
    select 1 from bank_txn_audience x where x.transaction_id = t.id and ((x.kind = 'USER' and x.target_id = ${v.userId}::uuid) ${divs})))`;
}

export type TxnFilter = { from?: string; to?: string; accountId?: string; q?: string; classification?: string; projectId?: string };

export function filterCond(f: TxnFilter): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.from && DATE_RE.test(f.from)) parts.push(sql`e.eff_date >= ${f.from}`);
  if (f.to && DATE_RE.test(f.to)) parts.push(sql`e.eff_date <= ${f.to}`);
  if (isUuid(f.accountId)) parts.push(sql`t.account_id = ${f.accountId}`);
  if (isUuid(f.projectId)) parts.push(sql`t.project_id = ${f.projectId}`);
  if (f.classification && /^[A-Z_]{2,30}$/.test(f.classification)) parts.push(sql`t.classification::text = ${f.classification}`);
  if (f.q?.trim()) parts.push(sql`e.eff_description ilike ${`%${f.q.trim().slice(0, 50).replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  return sql.join(parts, sql` and `);
}

/** 本社・スタッフに見せてよい項目だけ（提供者のメモ・原本の訂正前の値・公開設定は含めない） */
export type VisibleTxn = {
  id: string;
  date: string;
  amount: number;
  description: string;
  corrected: boolean;
  classification: string;
  excluded: boolean;
  account: string;
  project: string | null;
};

const FROM = sql`from bank_transaction t join bank_account a on a.id = t.account_id join bank_txn_effective e on e.id = t.id left join project p on p.id = t.project_id`;

export async function listVisibleTxns(db: DB, v: Viewer, f: TxnFilter = {}, limit = 500): Promise<VisibleTxn[]> {
  const pol = await policyOf(db, v);
  if (!pol.viewDetails) throw forbidden("明細は公開されていません");
  const r = await db.execute<VisibleTxn>(sql`
    select t.id, e.eff_date::text as "date", e.eff_amount amount, e.eff_description description, e.corrected, t.classification::text classification, t.excluded,
      a.bank_name || ' ' || a.branch_name || ' ****' || a.account_number_last4 account, p.name project
    ${FROM} where ${visibleCond(v)} and ${filterCond(f)}
    order by e.eff_date desc, t.imported_at desc limit ${limit}`);
  return r.rows;
}

/** 直接URLでの取得も同じ条件。見えない取引は「見つからない」 */
export async function getVisibleTxn(db: DB, v: Viewer, id: string): Promise<VisibleTxn> {
  const pol = await policyOf(db, v);
  if (!pol.viewDetails || !isUuid(id)) throw notFound("取引が見つかりません");
  const r = await db.execute<VisibleTxn>(sql`
    select t.id, e.eff_date::text as "date", e.eff_amount amount, e.eff_description description, e.corrected, t.classification::text classification, t.excluded,
      a.bank_name || ' ' || a.branch_name || ' ****' || a.account_number_last4 account, p.name project
    ${FROM} where ${visibleCond(v)} and t.id = ${id}`);
  if (!r.rows[0]) throw notFound("取引が見つかりません");
  return r.rows[0];
}

export type Totals = { count: number; income: number; expense: number; net: number; months: { month: string; income: number; expense: number }[] };

async function totals(db: DB, cond: SQL, f: TxnFilter): Promise<Totals> {
  const [t] = (await db.execute<{ count: number; income: number; expense: number }>(sql`
    select count(*)::int as "count", coalesce(sum(e.eff_amount) filter (where e.eff_amount > 0), 0)::float8 income, coalesce(-sum(e.eff_amount) filter (where e.eff_amount < 0), 0)::float8 expense
    ${FROM} where ${cond} and not t.excluded and ${filterCond(f)}`)).rows;
  const months = (await db.execute<{ month: string; income: number; expense: number }>(sql`
    select to_char(e.eff_date, 'YYYY-MM') as "month", coalesce(sum(e.eff_amount) filter (where e.eff_amount > 0), 0)::float8 income, coalesce(-sum(e.eff_amount) filter (where e.eff_amount < 0), 0)::float8 expense
    ${FROM} where ${cond} and not t.excluded and ${filterCond(f)} group by 1 order by 1 desc limit 6`)).rows.reverse();
  return { count: t.count, income: t.income, expense: t.expense, net: t.income - t.expense, months };
}

export type Balance = { account: string; balance: number | null; asOf: string | null; isDemo: boolean };

/**
 * 集計と残高。権限のないものは計算もせず null を返す（画面に値を送らない）
 * - published: 閲覧できる取引だけの合計（「公開対象の入出金合計」。実際の残高ではない）
 * - all: 全取引の合計（非公開を含む）
 * - balances: 実際の銀行残高
 * 集計対象外（重複・誤取込）の取引はどの合計にも含めない
 */
export async function summarize(db: DB, v: Viewer, f: TxnFilter = {}) {
  const pol = await policyOf(db, v);
  const published = pol.viewPublishedTotals ? await totals(db, visibleCond(v), f) : null;
  const all = pol.viewAllTotals ? await totals(db, sql`a.company_id = ${v.companyId}`, f) : null;
  let balances: Balance[] | null = null;
  if (pol.viewRealBalance) {
    balances = (await db.execute<Balance>(sql`
      select a.bank_name || ' ' || a.branch_name || ' ****' || a.account_number_last4 account, a.balance::float8 balance, a.balance_as_of::text "asOf", a.is_demo "isDemo"
      from bank_account a where a.company_id = ${v.companyId} and a.archived_at is null order by a.bank_name`)).rows;
  }
  return { policy: pol, published, all, balances, balanceTotal: balances ? balances.reduce((s, b) => s + (b.balance ?? 0), 0) : null };
}

/** 閲覧できるもの（明細・集計・残高）が1つでもあるか */
export async function hasAnyVisible(db: DB, v: Viewer) {
  const pol = await policyOf(db, v);
  if (pol.viewRealBalance || pol.viewAllTotals) return true;
  if (!pol.viewDetails && !pol.viewPublishedTotals) return false;
  const r = await db.execute<{ n: number }>(sql`select 1 n ${FROM} where ${visibleCond(v)} limit 1`);
  return r.rows.length > 0;
}

/** 閲覧できる口座の選択肢（絞り込み用。公開取引のある口座だけ） */
export async function visibleAccounts(db: DB, v: Viewer) {
  const pol = await policyOf(db, v);
  if (!pol.viewDetails) return [];
  return (await db.execute<{ id: string; label: string }>(sql`
    select distinct a.id, a.bank_name || ' ****' || a.account_number_last4 label ${FROM} where ${visibleCond(v)} order by 2`)).rows;
}

/**
 * CSV出力（出力権限が必要。閲覧できる明細だけ）。出力した記録を残す。
 * 出力したファイルは利用者の手元に残り、あとから公開を止めても回収できない（画面に明記）
 */
export async function exportVisibleCsv(db: DB, actor: Actor, v: Viewer, f: TxnFilter = {}) {
  const pol = await policyOf(db, v);
  if (!pol.canExport) throw forbidden("CSV出力は許可されていません");
  const rows = await listVisibleTxns(db, v, f, 5000);
  await db.transaction((tx) =>
    writeAudit(tx, actor, { action: "finance.export", entityType: "finance_export", entityId: v.companyId, summary: `入出金CSVを出力（${rows.length}件・${v.kind === "PROVIDER" ? "提供者" : v.kind === "HQ" ? "本社" : "スタッフ"}）` }),
  );
  return toCsv(
    ["日付", "口座", "内容", "入金", "出金", "区分", "案件", "訂正あり", "集計対象外"],
    rows.map((r) => [r.date, r.account, r.description, r.amount > 0 ? r.amount : "", r.amount < 0 ? -r.amount : "", r.classification, r.project ?? "", r.corrected ? "はい" : "", r.excluded ? "はい" : ""]),
  );
}

/** プレビュー用: 閲覧者に表示されないもの（提供者だけが見る） */
export async function hiddenSummary(db: DB, actor: Actor, v: Viewer) {
  await assertProviderCompany(db, actor, v.companyId);
  const pol = await policyOf(db, v);
  const [r] = (await db.execute<{ total: number; visible: number }>(sql`
    select count(*)::int total, count(*) filter (where ${visibleCond(v)})::int visible ${FROM} where a.company_id = ${v.companyId}`)).rows;
  const notShown: string[] = [];
  if (!pol.viewDetails) notShown.push("明細（公開した取引も含め、一覧・詳細は表示されません）");
  else notShown.push(`公開していない取引 ${r.total - r.visible}件（下書き・公開停止・公開先に含まれないもの）`);
  if (!pol.viewRealBalance) notShown.push("実際の銀行残高");
  if (!pol.viewAllTotals) notShown.push("全取引（非公開を含む）の集計");
  if (!pol.viewPublishedTotals) notShown.push("公開された取引の集計");
  if (!pol.canExport) notShown.push("CSV出力");
  notShown.push("提供者のメモ・確認状態・訂正前の原本の値・公開設定・操作履歴・銀行連携の情報");
  return { total: r.total, visible: r.visible, notShown, policy: pol };
}
