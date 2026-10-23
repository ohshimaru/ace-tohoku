/**
 * 経営数値の集計（会社全体・事業部別）
 * - 売上: sale の税抜金額（計上月）
 * - 直接経費: 事業部に紐付く承認済み経費（税抜）＋ 確定・公開済みの稼働明細の稼働分・調整分（税抜）
 *   稼働明細の立替経費行は元の経費として既に計上済みのため加えない（二重計上防止）
 * - 共通経費: 事業部なしの承認済み経費（税抜）。配賦ルールで各事業部へ按分（端数は合計が一致するよう調整）。
 *   全社合計では共通経費を1回だけ数え、配賦できなかった分は「未配賦」として表示する
 */
import { asc, inArray, isNull, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { allocationRule, allocationShare, division } from "@/db/schema";
import { type Actor, can, canAccessDivision, divisionScope, isStaff } from "@/lib/access";
import { addDays, addMonths, currentMonthJst, monthsBetween, toDateValue, todayJst } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import { allocate } from "@/lib/money";
import { getSettings } from "./masters";
import { summarize, viewerFor } from "./finance-visibility";

export type PeriodFilter = { from: string; to: string; divisionId?: string };

type DivRow = { id: string; name: string; code: string; kind: string; sortOrder: number };

/** 税抜の稼働明細コスト（内税ドライバーの明細は含まれる消費税を除く） */
const statementCostSql = sql`case when s.snapshot->>'taxMode' = 'INCLUSIVE' then l.amount - floor(l.amount * 10 / 110) else l.amount end`;

async function divisionMonthly(db: Tx, from: string, to: string) {
  const sales = await db.execute<{ division_id: string; month: string; v: number }>(sql`
    select division_id, month, sum(amount_ex_tax)::float8 v from sale
    where canceled_at is null and month between ${from} and ${to} group by 1, 2`);
  const expenses = await db.execute<{ division_id: string; month: string; v: number; outsourcing: number }>(sql`
    select e.division_id, e.month, sum(e.amount - e.tax_amount)::float8 v,
      coalesce(sum(e.amount - e.tax_amount) filter (where c.is_outsourcing), 0)::float8 outsourcing
    from expense e join expense_category c on c.id = e.category_id
    where e.status = 'APPROVED' and e.division_id is not null and e.month between ${from} and ${to} group by 1, 2`);
  const statements = await db.execute<{ division_id: string; month: string; v: number }>(sql`
    select l.division_id, s.month, sum(${statementCostSql})::float8 v
    from statement_line l join statement s on s.id = l.statement_id
    where s.status in ('CONFIRMED', 'PUBLISHED') and l.kind in ('WORK', 'ADJUSTMENT') and s.month between ${from} and ${to}
    group by 1, 2`);
  const common = await db.execute<{ month: string; category_id: string; v: number }>(sql`
    select month, category_id, sum(amount - tax_amount)::float8 v from expense
    where status = 'APPROVED' and division_id is null and month between ${from} and ${to} group by 1, 2`);
  return { sales: sales.rows, expenses: expenses.rows, statements: statements.rows, common: common.rows };
}

/** 共通経費の配賦（月×ルールごとに按分） */
async function allocateCommon(db: Tx, divs: DivRow[], common: { month: string; category_id: string; v: number }[], salesByDivMonth: Map<string, number>) {
  const rules = await db.select().from(allocationRule);
  const shares = await db.select().from(allocationShare);
  const allocated = new Map<string, number>(); // `${divId}|${month}`
  const unallocated = new Map<string, number>(); // month
  const groups = new Map<string, { month: string; ruleId: string | null; v: number }>();
  for (const c of common) {
    const candidates = rules
      .filter((r) => r.effectiveFrom <= c.month && (!r.effectiveTo || r.effectiveTo >= c.month) && (r.categoryId === null || r.categoryId === c.category_id))
      .sort((a, b) => (a.categoryId ? 0 : 1) - (b.categoryId ? 0 : 1) || b.priority - a.priority);
    const r = candidates[0];
    const key = `${c.month}|${r?.id ?? "none"}`;
    const g = groups.get(key) ?? { month: c.month, ruleId: r?.id ?? null, v: 0 };
    g.v += c.v;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const r = rules.find((x) => x.id === g.ruleId);
    let weights: number[] = [];
    if (r?.method === "FIXED_RATIO") weights = divs.map((d) => shares.find((s) => s.ruleId === r.id && s.divisionId === d.id)?.ratioBp ?? 0);
    if (r?.method === "SALES_RATIO") weights = divs.map((d) => Math.max(0, salesByDivMonth.get(`${d.id}|${g.month}`) ?? 0));
    const sum = weights.reduce((s, w) => s + w, 0);
    if (!r || r.method === "NONE" || sum <= 0) {
      unallocated.set(g.month, (unallocated.get(g.month) ?? 0) + g.v);
      continue;
    }
    // 固定割合の合計が100%未満なら、残りは未配賦として残す
    const total = r.method === "FIXED_RATIO" && sum < 10000 ? Math.round((g.v * sum) / 10000) : g.v;
    const parts = allocate(total, weights);
    divs.forEach((d, i) => allocated.set(`${d.id}|${g.month}`, (allocated.get(`${d.id}|${g.month}`) ?? 0) + parts[i]));
    if (total !== g.v) unallocated.set(g.month, (unallocated.get(g.month) ?? 0) + (g.v - total));
  }
  return { allocated, unallocated };
}

export type DivisionPL = {
  divisionId: string;
  name: string;
  kind: string;
  sales: number;
  directExpenses: number;
  outsourcing: number;
  statementCost: number;
  directCost: number;
  allocatedCommon: number;
  profit: number;
  margin: number | null;
  outsourcingRatio: number | null;
};

/** 期間の事業部別損益（責任者は担当事業部のみ。共通経費の全額は全社権限のみ） */
export async function getPL(db: DB, actor: Actor, f: PeriodFilter) {
  if (!isStaff(actor)) throw forbidden();
  if (f.divisionId && !canAccessDivision(actor, f.divisionId)) throw forbidden("担当外の事業部です");
  const all = await db.select({ id: division.id, name: division.name, code: division.code, kind: division.kind, sortOrder: division.sortOrder }).from(division).where(isNull(division.archivedAt)).orderBy(asc(division.sortOrder));
  const data = await divisionMonthly(db, f.from, f.to);
  const salesBy = new Map<string, number>();
  for (const r of data.sales) salesBy.set(`${r.division_id}|${r.month}`, r.v);
  const { allocated, unallocated } = await allocateCommon(db, all, data.common, salesBy);
  const scope = divisionScope(actor);
  const visible = all.filter((d) => (!scope || scope.includes(d.id)) && (!f.divisionId || d.id === f.divisionId));
  const sumWhere = <T extends { division_id: string; v: number }>(rows: T[], id: string, k: keyof T = "v") => rows.filter((r) => r.division_id === id).reduce((s, r) => s + Number(r[k]), 0);
  const rows: DivisionPL[] = visible.map((d) => {
    const sales = sumWhere(data.sales, d.id);
    const directExpenses = sumWhere(data.expenses, d.id);
    const outsourcingExp = sumWhere(data.expenses, d.id, "outsourcing");
    const statementCost = sumWhere(data.statements, d.id);
    const allocatedCommon = [...allocated.entries()].filter(([k]) => k.startsWith(`${d.id}|`)).reduce((s, [, v]) => s + v, 0);
    const directCost = directExpenses + statementCost;
    const profit = sales - directCost - allocatedCommon;
    const outsourcing = outsourcingExp + statementCost;
    return { divisionId: d.id, name: d.name, kind: d.kind, sales, directExpenses, outsourcing, statementCost, directCost, allocatedCommon, profit, margin: sales > 0 ? profit / sales : null, outsourcingRatio: sales > 0 ? outsourcing / sales : null };
  });
  const companyWide = !scope && !f.divisionId;
  const commonTotal = data.common.reduce((s, r) => s + r.v, 0);
  const unallocatedTotal = [...unallocated.values()].reduce((s, v) => s + v, 0);
  const total = rows.reduce(
    (t, r) => ({ sales: t.sales + r.sales, directCost: t.directCost + r.directCost, allocated: t.allocated + r.allocatedCommon }),
    { sales: 0, directCost: 0, allocated: 0 },
  );
  // 全社: 売上 − 直接経費 − 共通経費（配賦済み＋未配賦 = 共通経費の全額を1回だけ）
  const companyProfit = companyWide ? total.sales - total.directCost - commonTotal : null;
  return {
    rows,
    companyWide,
    totals: {
      sales: total.sales,
      directCost: total.directCost,
      commonTotal: companyWide ? commonTotal : null,
      allocatedCommon: total.allocated,
      unallocatedCommon: companyWide ? unallocatedTotal : null,
      profit: companyWide ? companyProfit! : total.sales - total.directCost - total.allocated,
      margin: total.sales > 0 ? (companyWide ? companyProfit! : total.sales - total.directCost - total.allocated) / total.sales : null,
    },
  };
}

/** 月次推移 */
export async function getTrend(db: DB, actor: Actor, endMonth: string, months = 6, divisionId?: string) {
  const from = addMonths(endMonth, -(months - 1));
  const out = [];
  for (const m of monthsBetween(from, endMonth)) {
    const pl = await getPL(db, actor, { from: m, to: m, divisionId });
    out.push({ month: m, sales: pl.totals.sales, cost: pl.totals.directCost + (pl.totals.commonTotal ?? pl.totals.allocatedCommon), profit: pl.totals.profit });
  }
  return out;
}

/**
 * 資金・入出金予定（経営者・経理）
 * 銀行の情報はサービス提供者の公開設定に従う（finance-visibility.summarize）。
 * - 実際の銀行残高・資金余力は「実際の銀行残高」の閲覧が許可されている場合だけ計算する
 * - それ以外は「公開対象の入出金合計」（公開された取引だけの合計）を表示する
 */
export async function getCashPosition(db: DB, actor: Actor) {
  if (!can.viewBank(actor)) throw forbidden("資金は経営者・経理のみ閲覧できます");
  const s = await getSettings(db);
  const today = todayJst();
  const horizon = addDays(today, s.cashHorizonDays);
  const viewer = await viewerFor(db, actor);
  const fin = await summarize(db, viewer, {});
  const [rec] = (await db.execute<{ due: number; overdue: number; total: number }>(sql`
    with o as (
      select s.expected_receipt_date d, s.amount_ex_tax + s.tax_amount - coalesce((select sum(r.amount) from receipt r where r.sale_id = s.id and r.canceled_at is null), 0) rest
      from sale s where s.canceled_at is null)
    select coalesce(sum(rest) filter (where d between ${today} and ${horizon}), 0)::float8 due,
           coalesce(sum(rest) filter (where d < ${today}), 0)::float8 overdue,
           coalesce(sum(rest), 0)::float8 total
    from o where rest > 0`)).rows;
  const [pay] = (await db.execute<{ due: number; total: number; overdue: number }>(sql`
    select coalesce(sum(amount) filter (where due_date <= ${horizon}), 0)::float8 due,
           coalesce(sum(amount) filter (where due_date < ${today}), 0)::float8 overdue,
           coalesce(sum(amount), 0)::float8 total
    from payable where status = 'SCHEDULED'`)).rows;
  return {
    policy: fin.policy,
    published: fin.published,
    all: fin.all,
    balances: fin.balances,
    bankTotal: fin.balanceTotal,
    anyDemo: !!fin.balances?.some((b) => b.isDemo),
    horizonDays: s.cashHorizonDays,
    receivablesDue: rec.due,
    receivablesOverdue: rec.overdue,
    receivablesTotal: rec.total,
    payablesDue: pay.due,
    payablesOverdue: pay.overdue,
    payablesTotal: pay.total,
    /** 資金余力 = 銀行残高 − 期間内の支払予定 ＋ 期間内の入金予定（実際の残高が許可されている場合だけ） */
    cashCapacity: fin.balanceTotal === null ? null : fin.balanceTotal - pay.due + rec.due,
    warningThreshold: s.cashWarningThreshold,
  };
}

/** 未収金（事業部権限に応じて） */
export async function getReceivables(db: DB, actor: Actor) {
  const scope = divisionScope(actor);
  const [r] = (await db.execute<{ total: number; overdue: number }>(sql`
    with o as (
      select s.expected_receipt_date d, s.amount_ex_tax + s.tax_amount - coalesce((select sum(r.amount) from receipt r where r.sale_id = s.id and r.canceled_at is null), 0) rest
      from sale s where s.canceled_at is null ${scope ? (scope.length ? sql`and s.division_id in ${scope}` : sql`and false`) : sql``})
    select coalesce(sum(rest), 0)::float8 total, coalesce(sum(rest) filter (where d < ${todayJst()}), 0)::float8 overdue from o where rest > 0`)).rows;
  return r;
}

/** 対応が必要な件数（承認待ち・未提出・未確定） */
export async function getWorkQueue(db: DB, actor: Actor, month = currentMonthJst()) {
  const scope = divisionScope(actor);
  const divCond = (col: string) => (scope ? (scope.length ? sql`and ${sql.raw(col)} in ${scope}` : sql`and false`) : sql``);
  const today = todayJst();
  const [q] = (await db.execute<{
    pending_expenses: number;
    pending_amount: number;
    no_receipt: number;
    pending_reports: number;
    missing_reports: number;
    draft_statements: number;
    pending_budget_requests: number;
    open_tasks: number;
  }>(sql`
    select
      (select count(*) from expense e where e.status = 'SUBMITTED' and e.applicant_id <> ${actor.userId} ${divCond("e.division_id")})::int pending_expenses,
      (select coalesce(sum(e.amount), 0) from expense e where e.status = 'SUBMITTED' ${divCond("e.division_id")})::float8 pending_amount,
      (select count(*) from expense e where e.status in ('SUBMITTED', 'APPROVED') and e.month >= ${addMonths(month, -1)}
         and not exists (select 1 from stored_file f where f.owner_type = 'EXPENSE' and f.owner_id = e.id) ${divCond("e.division_id")})::int no_receipt,
      (select count(*) from daily_report r join project p on p.id = r.project_id where r.status = 'SUBMITTED' ${divCond("p.division_id")})::int pending_reports,
      (select count(*) from assignment a join shift_slot sl on sl.id = a.slot_id join project p on p.id = sl.project_id
         where a.status = 'CONFIRMED' and a.work_date < ${today} and a.work_date >= ${addDays(today, -31)}
         and not exists (select 1 from daily_report r where r.driver_id = a.driver_id and r.project_id = sl.project_id and r.work_date = a.work_date and r.status <> 'DRAFT')
         ${divCond("p.division_id")})::int missing_reports,
      (select count(*) from statement s where s.status in ('DRAFT', 'REVIEW')
         and exists (select 1 from driver d where d.user_id = s.driver_id ${divCond("d.division_id")}))::int draft_statements,
      (select count(*) from budget_request b where b.status = 'PENDING' ${divCond("b.division_id")})::int pending_budget_requests,
      (select count(*) from action_card c where c.status in ('OPEN', 'IN_PROGRESS') and c.resolved_at is null
         ${scope ? sql`and c.rule_key not like 'cash.%'` : sql``} ${divCond("c.division_id")})::int open_tasks`)).rows;
  const periods = await db.execute<{ month: string; deadline: Date; unsubmitted: number }>(sql`
    select p.month, p.deadline,
      (select count(*) from driver d join app_user u on u.id = d.user_id
        where u.status = 'ACTIVE' ${divCond("d.division_id")}
        and not exists (select 1 from availability_submission x where x.driver_id = d.user_id and x.month = p.month and x.status = 'SUBMITTED'))::int unsubmitted
    from availability_period p where p.status = 'OPEN' order by p.month`);
  return { ...q, availability: periods.rows.map((r) => ({ ...r, deadline: toDateValue(r.deadline) })) };
}

/* ---------------- 明細へのドリルダウン ---------------- */

export const DRILL = {
  sales: "売上（税抜・計上月）",
  directExpenses: "直接経費（承認済み経費・税抜）",
  statementCost: "稼働明細の外注費（確定・公開分・税抜）",
  common: "共通経費（承認済み・税抜）",
} as const;
export type DrillKind = keyof typeof DRILL;

export async function drill(db: DB, actor: Actor, kind: DrillKind, f: PeriodFilter) {
  if (!isStaff(actor)) throw forbidden();
  if (f.divisionId && !canAccessDivision(actor, f.divisionId)) throw forbidden();
  const scope = divisionScope(actor);
  const divFilter = (col: string) =>
    f.divisionId ? sql`and ${sql.raw(col)} = ${f.divisionId}` : scope ? (scope.length ? sql`and ${sql.raw(col)} in ${scope}` : sql`and false`) : sql``;
  type R = { date: string; label: string; sub: string; amount: number; href: string };
  if (kind === "sales") {
    const r = await db.execute<R>(sql`select s.recognized_on::text date, d.name || ' / ' || coalesce(p.code, '—') label, s.description sub, s.amount_ex_tax::float8 amount, '/app/sales/' || s.id href
      from sale s join division d on d.id = s.division_id left join project p on p.id = s.project_id
      where s.canceled_at is null and s.month between ${f.from} and ${f.to} ${divFilter("s.division_id")} order by s.recognized_on limit 1000`);
    return r.rows;
  }
  if (kind === "directExpenses") {
    const r = await db.execute<R>(sql`select e.used_on::text date, d.name || ' / ' || c.name label, e.payee || '：' || e.purpose sub, (e.amount - e.tax_amount)::float8 amount, '/app/expenses/' || e.id href
      from expense e join division d on d.id = e.division_id join expense_category c on c.id = e.category_id
      where e.status = 'APPROVED' and e.month between ${f.from} and ${f.to} ${divFilter("e.division_id")} order by e.used_on limit 1000`);
    return r.rows;
  }
  if (kind === "statementCost") {
    const r = await db.execute<R>(sql`select coalesce(l.work_date::text, s.month || '-01') date, d.name || ' / ' || u.name label, l.description sub, (${statementCostSql})::float8 amount, '/app/statements/' || s.id href
      from statement_line l join statement s on s.id = l.statement_id join division d on d.id = l.division_id join app_user u on u.id = s.driver_id
      where s.status in ('CONFIRMED','PUBLISHED') and l.kind in ('WORK','ADJUSTMENT') and s.month between ${f.from} and ${f.to} ${divFilter("l.division_id")} order by 1 limit 1000`);
    return r.rows;
  }
  if (scope) throw forbidden("共通経費の明細は経営者・経理のみ閲覧できます");
  const r = await db.execute<R>(sql`select e.used_on::text date, c.name label, e.payee || '：' || e.purpose sub, (e.amount - e.tax_amount)::float8 amount, '/app/expenses/' || e.id href
    from expense e join expense_category c on c.id = e.category_id
    where e.status = 'APPROVED' and e.division_id is null and e.month between ${f.from} and ${f.to} order by e.used_on limit 1000`);
  return r.rows;
}

export async function listAllocationRules(db: DB) {
  const rules = await db.select().from(allocationRule).orderBy(asc(allocationRule.effectiveFrom));
  const shares = rules.length ? await db.select().from(allocationShare).where(inArray(allocationShare.ruleId, rules.map((r) => r.id))) : [];
  return rules.map((r) => ({ ...r, shares: shares.filter((s) => s.ruleId === r.id) }));
}


/** 案件別の損益（期間内、税抜） */
export async function getProjectPL(db: DB, actor: Actor, f: PeriodFilter) {
  if (!isStaff(actor)) throw forbidden();
  if (f.divisionId && !canAccessDivision(actor, f.divisionId)) throw forbidden();
  const scope = divisionScope(actor);
  const divCond = f.divisionId ? sql`and p.division_id = ${f.divisionId}` : scope ? (scope.length ? sql`and p.division_id in ${scope}` : sql`and false`) : sql``;
  const r = await db.execute<{ id: string; code: string; name: string; division: string; category: string; contract_type: string; sales: number; expenses: number; statement_cost: number }>(sql`
    select p.id, p.code, p.name, d.name division, p.category, p.contract_type,
      coalesce((select sum(s.amount_ex_tax) from sale s where s.project_id = p.id and s.canceled_at is null and s.month between ${f.from} and ${f.to}), 0)::float8 sales,
      coalesce((select sum(e.amount - e.tax_amount) from expense e where e.project_id = p.id and e.status = 'APPROVED' and e.month between ${f.from} and ${f.to}), 0)::float8 expenses,
      coalesce((select sum(${statementCostSql}) from statement_line l join statement s on s.id = l.statement_id
        where l.project_id = p.id and s.status in ('CONFIRMED','PUBLISHED') and l.kind in ('WORK','ADJUSTMENT') and s.month between ${f.from} and ${f.to}), 0)::float8 statement_cost
    from project p join division d on d.id = p.division_id
    where p.archived_at is null ${divCond}
    order by d.sort_order, p.code`);
  return r.rows
    .map((x) => ({ ...x, cost: x.expenses + x.statement_cost, profit: x.sales - x.expenses - x.statement_cost }))
    .filter((x) => x.sales || x.cost);
}
