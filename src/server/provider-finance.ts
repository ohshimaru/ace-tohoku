/**
 * サービス提供者の入出金管理（担当会社だけ）
 *
 * 操作は次の4種類に分けている（それぞれ別の関数・別の監査ログ）
 *  1. 表示先の変更（公開状態・本社公開・スタッフ公開・公開対象）… setVisibility（一括も同じ関数）
 *  2. 分類・メモ・確認状態・案件の編集 … updateTxnMeta
 *  3. 手動取引の登録・訂正 … addManualTxn / addCorrection（原本は変更せず訂正を追記）
 *  4. 重複・誤取込を集計対象から除外 … setExcluded（非公開とは別。原本も集計の元データも消さない）
 * 振込・送金の機能はない。
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { bankAccount, bankTransaction, bankTxnAudience, bankTxnCorrection, disclosurePolicy } from "@/db/schema";
import { type Actor, isProvider } from "@/lib/access";
import { DATE_RE } from "@/lib/dates";
import { DEFAULT_POLICY, type Policy } from "@/lib/disclosure";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { txnAccess } from "./bank";
import { assertProviderCompany, filterCond, isUuid, type TxnFilter } from "./finance-visibility";
import { parse, zText } from "./validate";

export async function listAssignedCompanies(db: DB, actor: Actor) {
  if (!isProvider(actor)) throw forbidden();
  return (await db.execute<{ id: string; name: string; is_self: boolean; is_demo: boolean; accounts: number; drafts: number; failed: number }>(sql`
    select c.id, c.name, c.is_self, c.is_demo,
      (select count(*)::int from bank_account a where a.company_id = c.id and a.archived_at is null) accounts,
      (select count(*)::int from bank_transaction t join bank_account a on a.id = t.account_id where a.company_id = c.id and t.publish_status = 'DRAFT') drafts,
      (select count(*)::int from bank_account a where a.company_id = c.id and a.archived_at is null and a.sync_status = 'FAILED') failed
    from company c join provider_assignment pa on pa.company_id = c.id and pa.user_id = ${actor.userId} order by c.is_self desc, c.name`)).rows;
}

/* ---------------- 一覧（原本＋公開状況） ---------------- */

export type ProviderFilter = TxnFilter & { status?: string; hq?: string; staff?: string; excluded?: string };

function providerCond(companyId: string, f: ProviderFilter) {
  const parts = [sql`a.company_id = ${companyId}`, filterCond(f)];
  if (f.status && ["DRAFT", "PUBLISHED", "SUSPENDED"].includes(f.status)) parts.push(sql`t.publish_status::text = ${f.status}`);
  if (f.hq === "1") parts.push(sql`t.hq_visible`);
  if (f.hq === "0") parts.push(sql`not t.hq_visible`);
  if (f.staff === "1") parts.push(sql`t.staff_visible`);
  if (f.staff === "0") parts.push(sql`not t.staff_visible`);
  if (f.excluded === "1") parts.push(sql`t.excluded`);
  return sql.join(parts, sql` and `);
}

export type ProviderTxn = {
  id: string;
  account_id: string;
  account: string;
  is_demo: boolean;
  source: string;
  original_date: string;
  original_amount: number;
  original_description: string;
  balance_after: number | null;
  eff_date: string;
  eff_amount: number;
  eff_description: string;
  corrected: boolean;
  classification: string;
  note: string | null;
  confirm_status: string;
  publish_status: string;
  hq_visible: boolean;
  staff_visible: boolean;
  excluded: boolean;
  exclude_reason: string | null;
  project_id: string | null;
  project: string | null;
  audience: string | null;
  updated_by: string | null;
  updated_at: string | null;
  matched: number;
};

const SELECT = sql`
  select t.id, t.account_id, a.bank_name || ' ' || a.branch_name || ' ****' || a.account_number_last4 account, a.is_demo, t.source,
    e.original_date::text original_date, e.original_amount, e.original_description, t.balance_after,
    e.eff_date::text eff_date, e.eff_amount, e.eff_description, e.corrected,
    t.classification::text classification, t.note, t.confirm_status::text confirm_status, t.publish_status::text publish_status,
    t.hq_visible, t.staff_visible, t.excluded, t.exclude_reason, t.project_id, p.name project,
    (select string_agg(case when x.kind = 'USER' then coalesce(u.name, '（不明）') else '事業部:' || coalesce(dv.name, '（不明）') end, '、' order by x.kind, coalesce(u.name, dv.name))
       from bank_txn_audience x left join app_user u on x.kind = 'USER' and u.id = x.target_id left join division dv on x.kind = 'DIVISION' and dv.id = x.target_id
       where x.transaction_id = t.id) audience,
    ub.name updated_by, t.updated_at::text updated_at,
    (select coalesce(sum(m.amount), 0)::int from bank_match m where m.transaction_id = t.id and m.unmatched_at is null) matched
  from bank_transaction t join bank_account a on a.id = t.account_id join bank_txn_effective e on e.id = t.id
  left join project p on p.id = t.project_id left join app_user ub on ub.id = t.updated_by_id`;

export async function providerListTxns(db: DB, actor: Actor, companyId: string, f: ProviderFilter = {}) {
  await assertProviderCompany(db, actor, companyId);
  return (await db.execute<ProviderTxn>(sql`${SELECT} where ${providerCond(companyId, f)} order by e.eff_date desc, t.imported_at desc limit 500`)).rows;
}

export async function providerGetTxn(db: DB, actor: Actor, txnId: string) {
  const { company } = await txnAccess(db, actor, txnId);
  const [t] = (await db.execute<ProviderTxn>(sql`${SELECT} where t.id = ${txnId}`)).rows;
  const corrections = (await db.execute<{ id: string; txn_date: string; amount: number; description: string; reason: string; by: string | null; created_at: string }>(sql`
    select c.id, c.txn_date::text txn_date, c.amount, c.description, c.reason, u.name as "by", c.created_at::text created_at
    from bank_txn_correction c left join app_user u on u.id = c.created_by_id where c.transaction_id = ${txnId} order by c.created_at desc`)).rows;
  const audience = (await db.execute<{ kind: string; target_id: string }>(sql`select kind, target_id from bank_txn_audience where transaction_id = ${txnId}`)).rows;
  const history = (await db.execute<{ id: number; at: string; actor_name: string | null; action: string; summary: string; changes: unknown }>(sql`
    select id, at::text at, actor_name, action, summary, changes from audit_log where entity_type = 'bank_transaction' and entity_id = ${txnId} order by id desc limit 100`)).rows;
  return { t, company, corrections, audience, history };
}

/** 公開対象に選べるスタッフ・事業部（その会社のドライバーと、事業部） */
export async function audienceOptions(db: DB, actor: Actor, companyId: string) {
  await assertProviderCompany(db, actor, companyId);
  const staff = (await db.execute<{ id: string; name: string; division: string | null }>(sql`
    select u.id, u.name, dv.name division from app_user u left join driver d on d.user_id = u.id left join division dv on dv.id = d.division_id
    where u.role = 'DRIVER' and u.company_id = ${companyId} and u.status <> 'SUSPENDED' order by dv.name, u.name`)).rows;
  // 事業部は自社のもの（このシステムの事業部は自社に属する）
  const divisions = (await db.execute<{ id: string; name: string }>(sql`
    select dv.id, dv.name from division dv join company c on c.id = ${companyId} and c.is_self where dv.archived_at is null order by dv.sort_order, dv.name`)).rows;
  const projects = (await db.execute<{ id: string; name: string }>(sql`
    select p.id, p.name from project p join company c on c.id = ${companyId} and c.is_self order by p.name`)).rows;
  return { staff, divisions, projects };
}

/* ---------------- 1. 表示先の変更（一括を含む） ---------------- */

export type Selection = { ids?: string[]; filter?: ProviderFilter };
export type VisibilityChange = {
  status?: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  hq?: boolean;
  staff?: boolean;
  /** 指定したときは公開対象を置き換える */
  audience?: { users: string[]; divisions: string[] };
};

/** 対象の取引ID（担当会社のものだけ）。指定IDに他社・存在しない取引が含まれていれば拒否 */
export async function resolveSelection(db: DB | Tx, actor: Actor, companyId: string, sel: Selection) {
  await assertProviderCompany(db as DB, actor, companyId);
  if (sel.ids) {
    const ids = [...new Set(sel.ids)];
    if (!ids.length) throw invalid("取引を選んでください");
    if (ids.length > 2000 || !ids.every(isUuid)) throw invalid("対象の指定が正しくありません");
    const r = await db.execute<{ id: string }>(sql`select t.id from bank_transaction t join bank_account a on a.id = t.account_id where a.company_id = ${companyId} and t.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    if (r.rows.length !== ids.length) throw notFound("対象の取引が見つかりません");
    return ids;
  }
  if (sel.filter) {
    const r = await db.execute<{ id: string }>(sql`select t.id from bank_transaction t join bank_account a on a.id = t.account_id join bank_txn_effective e on e.id = t.id where ${providerCond(companyId, sel.filter)} limit 2001`);
    if (r.rows.length > 2000) throw invalid("対象が多すぎます（2000件まで）。期間などで絞り込んでください");
    return r.rows.map((x) => x.id);
  }
  throw invalid("対象を指定してください");
}

async function validateAudience(db: DB | Tx, companyId: string, a: { users: string[]; divisions: string[] }) {
  const users = [...new Set(a.users)];
  const divisions = [...new Set(a.divisions)];
  if (!users.every(isUuid) || !divisions.every(isUuid)) throw invalid("公開対象の指定が正しくありません");
  if (users.length) {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int n from app_user where role = 'DRIVER' and status <> 'SUSPENDED' and company_id = ${companyId} and id in (${sql.join(users.map((u) => sql`${u}::uuid`), sql`, `)})`);
    if (r.rows[0].n !== users.length) throw invalid("公開対象のスタッフが見つかりません（この会社のスタッフだけ選べます）");
  }
  if (divisions.length) {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int n from division dv join company c on c.id = ${companyId} and c.is_self where dv.id in (${sql.join(divisions.map((d) => sql`${d}::uuid`), sql`, `)})`);
    if (r.rows[0].n !== divisions.length) throw invalid("公開対象の事業部が見つかりません");
  }
  return { users, divisions };
}

export function describeChange(c: VisibilityChange, names?: { users: Map<string, string>; divisions: Map<string, string> }) {
  const out: string[] = [];
  if (c.status) out.push(`公開状態を「${{ DRAFT: "下書き", PUBLISHED: "公開中", SUSPENDED: "公開停止" }[c.status]}」に`);
  if (c.hq !== undefined) out.push(`本社に${c.hq ? "公開する" : "公開しない"}`);
  if (c.staff !== undefined) out.push(`スタッフに${c.staff ? "公開する" : "公開しない"}`);
  if (c.audience) {
    const list = [...c.audience.users.map((u) => names?.users.get(u) ?? "スタッフ"), ...c.audience.divisions.map((d) => `事業部:${names?.divisions.get(d) ?? ""}`)];
    out.push(`スタッフの公開対象を「${list.length ? list.join("、") : "なし"}」に`);
  }
  return out.join("・");
}

/** 一括変更の確認（対象件数と、変更後に本社・スタッフに見える件数） */
export async function previewVisibility(db: DB, actor: Actor, companyId: string, sel: Selection, change: VisibilityChange) {
  const ids = await resolveSelection(db, actor, companyId, sel);
  if (change.audience) await validateAudience(db, companyId, change.audience);
  const cur = (await db.execute<{ publish_status: string; hq_visible: boolean; staff_visible: boolean; aud: number }>(sql`
    select publish_status::text, hq_visible, staff_visible, (select count(*)::int from bank_txn_audience x where x.transaction_id = t.id) aud
    from bank_transaction t where t.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows;
  let hq = 0, staff = 0, staffNoAudience = 0;
  for (const r of cur) {
    const st = change.status ?? r.publish_status;
    const h = change.hq ?? r.hq_visible;
    const s = change.staff ?? r.staff_visible;
    const aud = change.audience ? change.audience.users.length + change.audience.divisions.length : r.aud;
    if (st === "PUBLISHED" && h) hq++;
    if (st === "PUBLISHED" && s && aud > 0) staff++;
    if (s && aud === 0) staffNoAudience++;
  }
  return { ids, count: ids.length, afterHq: hq, afterStaff: staff, staffNoAudience };
}

/**
 * 表示先の変更。expectedCount を渡すと、確認時から対象件数が変わっていた場合は実行しない。
 * 取引ごとに変更前後を監査ログに残す
 */
export async function setVisibility(db: DB, actor: Actor, companyId: string, sel: Selection, change: VisibilityChange, expectedCount?: number) {
  if (change.status === undefined && change.hq === undefined && change.staff === undefined && !change.audience) throw invalid("変更内容を選んでください");
  return db.transaction(async (tx) => {
    const ids = await resolveSelection(tx, actor, companyId, sel);
    if (expectedCount !== undefined && ids.length !== expectedCount) throw conflict(`対象の件数が確認時（${expectedCount}件）から変わりました（現在 ${ids.length}件）。もう一度確認してください`);
    const aud = change.audience ? await validateAudience(tx, companyId, change.audience) : null;
    const rows = (await tx.execute<{ id: string; eff_date: string; eff_amount: number; publish_status: string; hq_visible: boolean; staff_visible: boolean }>(sql`
      select t.id, e.eff_date::text eff_date, e.eff_amount, t.publish_status::text, t.hq_visible, t.staff_visible
      from bank_transaction t join bank_txn_effective e on e.id = t.id where t.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) for update of t`)).rows;
    const now = new Date();
    for (const r of rows) {
      const beforeAud = (await tx.execute<{ kind: string; target_id: string }>(sql`select kind, target_id from bank_txn_audience where transaction_id = ${r.id} order by kind, target_id`)).rows;
      const before = { status: r.publish_status, hq: r.hq_visible, staff: r.staff_visible, audience: beforeAud.map((x) => `${x.kind}:${x.target_id}`) };
      const after = {
        status: change.status ?? r.publish_status,
        hq: change.hq ?? r.hq_visible,
        staff: change.staff ?? r.staff_visible,
        audience: aud ? [...aud.divisions.map((d) => `DIVISION:${d}`), ...aud.users.map((u) => `USER:${u}`)].sort() : before.audience,
      };
      if (after.staff && after.audience.length === 0) throw invalid("スタッフに公開する取引には、公開対象（スタッフまたは事業部）を1つ以上選んでください");
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      await tx
        .update(bankTransaction)
        .set({ publishStatus: after.status as "DRAFT" | "PUBLISHED" | "SUSPENDED", hqVisible: after.hq, staffVisible: after.staff, updatedById: actor.userId, updatedAt: now })
        .where(sql`${bankTransaction.id} = ${r.id}`);
      if (aud) {
        await tx.delete(bankTxnAudience).where(sql`${bankTxnAudience.transactionId} = ${r.id}`);
        const vals = [...aud.users.map((u) => ({ transactionId: r.id, kind: "USER", targetId: u })), ...aud.divisions.map((d) => ({ transactionId: r.id, kind: "DIVISION", targetId: d }))];
        if (vals.length) await tx.insert(bankTxnAudience).values(vals);
      }
      await writeAudit(tx, actor, {
        action: "bank.visibility",
        entityType: "bank_transaction",
        entityId: r.id,
        summary: `表示先を変更（${r.eff_date} ${r.eff_amount}円）: ${describeChange(change)}${ids.length > 1 ? `（一括 ${ids.length}件）` : ""}`,
        changes: { before, after },
      });
    }
    return { count: ids.length };
  });
}

/* ---------------- 2. 分類・メモ・確認状態・案件 ---------------- */

const metaInput = z.object({
  classification: z.enum(["UNCLASSIFIED", "SALES_RECEIPT", "EXPENSE_PAYMENT", "STATEMENT_PAYMENT", "TRANSFER", "LOAN", "TAX", "OTHER"]),
  note: z.string().trim().max(300).default(""),
  confirmStatus: z.enum(["UNCONFIRMED", "CONFIRMED", "NEEDS_REVIEW"]),
  projectId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().default(null)),
});

export async function updateTxnMeta(db: DB, actor: Actor, txnId: string, raw: z.input<typeof metaInput>) {
  const { company } = await txnAccess(db, actor, txnId);
  const input = parse(metaInput, raw);
  if (input.projectId && !company.is_self) throw invalid("案件はこのシステムで管理している会社の取引にだけ設定できます");
  if (input.projectId) {
    const r = await db.execute<{ id: string }>(sql`select id from project where id = ${input.projectId}`);
    if (!r.rows[0]) throw invalid("案件が見つかりません");
  }
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(bankTransaction).where(sql`${bankTransaction.id} = ${txnId}`).for("update");
    const before = { classification: t.classification, note: t.note, confirmStatus: t.confirmStatus, projectId: t.projectId };
    const after = { classification: input.classification, note: input.note || null, confirmStatus: input.confirmStatus, projectId: input.projectId };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await tx.update(bankTransaction).set({ ...after, updatedById: actor.userId, updatedAt: new Date() }).where(sql`${bankTransaction.id} = ${txnId}`);
    await writeAudit(tx, actor, { action: "bank.meta", entityType: "bank_transaction", entityId: txnId, summary: "分類・メモ・確認状態を編集", changes: { before, after } });
  });
}

/* ---------------- 3. 手動取引・訂正 ---------------- */

const amountInput = z.preprocess((v) => (typeof v === "string" ? v.replace(/[,円\s]/g, "") : v), z.coerce.number({ error: "金額は数字で入力してください" }).int("金額は円単位の整数で入力してください").refine((n) => n !== 0 && Math.abs(n) <= 10_000_000_000, "金額を正しく入力してください"));
const correctionInput = z.object({
  txnDate: z.string().regex(DATE_RE, "日付を正しく入力してください"),
  direction: z.enum(["in", "out"]),
  amount: amountInput,
  description: zText("内容", 200),
  reason: zText("理由", 300),
});

/** 原本は残したまま、訂正を追記する（以後の表示・集計は訂正後の値） */
export async function addCorrection(db: DB, actor: Actor, txnId: string, raw: z.input<typeof correctionInput>) {
  await txnAccess(db, actor, txnId);
  const input = parse(correctionInput, raw);
  const amount = input.direction === "in" ? Math.abs(input.amount) : -Math.abs(input.amount);
  await db.transaction(async (tx) => {
    const [cur] = (await tx.execute<{ eff_date: string; eff_amount: number; eff_description: string; matched: number }>(sql`
      select e.eff_date::text eff_date, e.eff_amount, e.eff_description, (select coalesce(sum(m.amount), 0)::int from bank_match m where m.transaction_id = e.id and m.unmatched_at is null) matched
      from bank_txn_effective e where e.id = ${txnId}`)).rows;
    if (cur.matched > Math.abs(amount) || (cur.matched > 0 && Math.sign(amount) !== Math.sign(cur.eff_amount))) throw invalid("照合済みの金額と合わなくなります。先に照合を解除してください");
    await tx.insert(bankTxnCorrection).values({ transactionId: txnId, txnDate: input.txnDate, amount, description: input.description, reason: input.reason, createdById: actor.userId });
    await tx.update(bankTransaction).set({ updatedById: actor.userId, updatedAt: new Date() }).where(sql`${bankTransaction.id} = ${txnId}`);
    await writeAudit(tx, actor, {
      action: "bank.correction",
      entityType: "bank_transaction",
      entityId: txnId,
      summary: `訂正を追加: ${input.reason}`,
      changes: { before: { date: cur.eff_date, amount: cur.eff_amount, description: cur.eff_description }, after: { date: input.txnDate, amount, description: input.description } },
    });
  });
}

const manualInput = correctionInput;

/** 手動取引の登録（銀行から取得できない取引など）。下書きとして登録し、理由を残す */
export async function addManualTxn(db: DB, actor: Actor, accountId: string, raw: z.input<typeof manualInput>) {
  if (!isUuid(accountId)) throw notFound("口座が見つかりません");
  const [acc] = await db.select().from(bankAccount).where(sql`${bankAccount.id} = ${accountId}`).limit(1);
  if (!acc || acc.archivedAt) throw notFound("口座が見つかりません");
  await assertProviderCompany(db, actor, acc.companyId).catch(() => {
    throw notFound("口座が見つかりません");
  });
  const input = parse(manualInput, raw);
  const amount = input.direction === "in" ? Math.abs(input.amount) : -Math.abs(input.amount);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(bankTransaction)
      .values({ accountId, txnDate: input.txnDate, amount, description: input.description, balanceAfter: null, externalId: `manual-${crypto.randomUUID()}`, source: "MANUAL", publishStatus: "DRAFT", note: `手動登録: ${input.reason}`.slice(0, 300), updatedById: actor.userId, updatedAt: new Date() })
      .returning({ id: bankTransaction.id });
    await writeAudit(tx, actor, { action: "bank.manual_create", entityType: "bank_transaction", entityId: t.id, summary: `手動取引を登録（${input.txnDate} ${amount}円）: ${input.reason}`, changes: { after: { date: input.txnDate, amount, description: input.description } } });
    return t.id;
  });
}

/* ---------------- 4. 集計対象外 ---------------- */

export async function setExcluded(db: DB, actor: Actor, txnId: string, excluded: boolean, reason: string) {
  await txnAccess(db, actor, txnId);
  const why = excluded ? parse(zText("理由", 300), reason) : reason.trim().slice(0, 300);
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(bankTransaction).where(sql`${bankTransaction.id} = ${txnId}`).for("update");
    if (t.excluded === excluded) throw conflict(excluded ? "既に集計対象外です" : "既に集計対象です");
    if (excluded) {
      const [m] = (await tx.execute<{ n: number }>(sql`select count(*)::int n from bank_match where transaction_id = ${txnId} and unmatched_at is null`)).rows;
      if (m.n > 0) throw invalid("照合済みの取引は集計対象外にできません。先に照合を解除してください");
    }
    await tx.update(bankTransaction).set({ excluded, excludeReason: excluded ? why : null, updatedById: actor.userId, updatedAt: new Date() }).where(sql`${bankTransaction.id} = ${txnId}`);
    await writeAudit(tx, actor, { action: excluded ? "bank.exclude" : "bank.include", entityType: "bank_transaction", entityId: txnId, summary: excluded ? `集計対象外にした: ${why}` : `集計対象に戻した${why ? `: ${why}` : ""}`, changes: { before: { excluded: t.excluded, reason: t.excludeReason }, after: { excluded, reason: excluded ? why : null } } });
  });
}

/* ---------------- 公開権限（本社・スタッフごと） ---------------- */

export async function listPolicies(db: DB, actor: Actor, companyId: string) {
  await assertProviderCompany(db, actor, companyId);
  const rows = (await db.execute<{ subject: string; view_details: boolean; view_real_balance: boolean; view_all_totals: boolean; view_published_totals: boolean; can_export: boolean; updated_at: string; by: string | null }>(sql`
    select p.subject, p.view_details, p.view_real_balance, p.view_all_totals, p.view_published_totals, p.can_export, p.updated_at::text updated_at, u.name as "by"
    from disclosure_policy p left join app_user u on u.id = p.updated_by_id where p.company_id = ${companyId}`)).rows;
  const map = new Map(rows.map((r) => [r.subject, { policy: { viewDetails: r.view_details, viewRealBalance: r.view_real_balance, viewAllTotals: r.view_all_totals, viewPublishedTotals: r.view_published_totals, canExport: r.can_export } as Policy, updatedAt: r.updated_at, by: r.by }]));
  const { staff } = await audienceOptions(db, actor, companyId);
  return {
    hq: map.get("HQ") ?? { policy: DEFAULT_POLICY.HQ, updatedAt: null, by: null },
    staff: staff.map((s) => ({ ...s, ...(map.get(`STAFF:${s.id}`) ?? { policy: DEFAULT_POLICY.STAFF, updatedAt: null, by: null }) })),
  };
}

const policyInput = z.object({ viewDetails: z.boolean(), viewRealBalance: z.boolean(), viewAllTotals: z.boolean(), viewPublishedTotals: z.boolean(), canExport: z.boolean() });

export async function savePolicy(db: DB, actor: Actor, companyId: string, subject: string, raw: Policy) {
  await assertProviderCompany(db, actor, companyId);
  const p = parse(policyInput, raw);
  if (subject !== "HQ") {
    const uid = subject.startsWith("STAFF:") ? subject.slice(6) : "";
    if (!isUuid(uid)) throw invalid("対象が正しくありません");
    const r = await db.execute<{ id: string }>(sql`select id from app_user where id = ${uid} and role = 'DRIVER' and company_id = ${companyId}`);
    if (!r.rows[0]) throw notFound("スタッフが見つかりません");
  }
  await db.transaction(async (tx) => {
    const cur = (await tx.execute<{ view_details: boolean; view_real_balance: boolean; view_all_totals: boolean; view_published_totals: boolean; can_export: boolean }>(sql`
      select view_details, view_real_balance, view_all_totals, view_published_totals, can_export from disclosure_policy where company_id = ${companyId} and subject = ${subject} for update`)).rows[0];
    const before = cur ? { viewDetails: cur.view_details, viewRealBalance: cur.view_real_balance, viewAllTotals: cur.view_all_totals, viewPublishedTotals: cur.view_published_totals, canExport: cur.can_export } : DEFAULT_POLICY[subject === "HQ" ? "HQ" : "STAFF"];
    await tx
      .insert(disclosurePolicy)
      .values({ companyId, subject, ...p, updatedById: actor.userId })
      .onConflictDoUpdate({ target: [disclosurePolicy.companyId, disclosurePolicy.subject], set: { ...p, updatedById: actor.userId, updatedAt: new Date() } });
    await writeAudit(tx, actor, { action: "disclosure.update", entityType: "disclosure_policy", entityId: `${companyId}:${subject}`, summary: `公開権限を変更（${subject === "HQ" ? "本社" : "スタッフ"}）`, changes: { before, after: p } });
  });
}

/* ---------------- 操作履歴 ---------------- */

export async function companyAudit(db: DB, actor: Actor, companyId: string, page = 1) {
  await assertProviderCompany(db, actor, companyId);
  const p = Math.max(1, Math.min(1000, page));
  const where = sql`(
      (l.entity_type = 'bank_transaction' and l.entity_id in (select t.id::text from bank_transaction t join bank_account a on a.id = t.account_id where a.company_id = ${companyId}))
   or (l.entity_type = 'bank_account' and l.entity_id in (select a.id::text from bank_account a where a.company_id = ${companyId}))
   or (l.entity_type = 'disclosure_policy' and l.entity_id like ${`${companyId}:%`})
   or (l.entity_type = 'finance_export' and l.entity_id = ${companyId}))`;
  const rows = (await db.execute<{ id: number; at: string; actor_name: string | null; action: string; entity_type: string; entity_id: string | null; summary: string; changes: unknown }>(sql`
    select l.id, l.at::text at, l.actor_name, l.action, l.entity_type, l.entity_id, l.summary, l.changes from audit_log l where ${where} order by l.id desc limit 50 offset ${(p - 1) * 50}`)).rows;
  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int total from audit_log l where ${where}`)).rows;
  return { rows, total, page: p };
}
