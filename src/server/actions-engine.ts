/**
 * AIアクションカード
 * - 根拠となる数値の計算と異常検知はルール（このファイル）で行う。LLM は説明文の整形にだけ使う（任意）
 * - カードは「ルール×対象」で一意。根拠が解消されたら自動で閉じる
 * - 支払い・契約締結・予算変更などは行わない（提案と対象明細へのリンクのみ）
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { actionCard, appUser } from "@/db/schema";
import { type Actor, divisionScope, isStaff } from "@/lib/access";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";

export async function listActionCards(db: DB, actor: Actor, opts: { status?: "active" | "all" | "done"; divisionId?: string; limit?: number } = {}) {
  if (!isStaff(actor)) throw forbidden();
  const scope = divisionScope(actor);
  const conds = [
    // 責任者には担当事業部と、自分の役割に割り当てられた全社カードのうち事業部に関するものだけ
    scope ? (scope.length ? inArray(actionCard.divisionId, scope) : sql`false`) : undefined,
    opts.divisionId ? eq(actionCard.divisionId, opts.divisionId) : undefined,
    opts.status === "done" ? inArray(actionCard.status, ["DONE", "DISMISSED"]) : opts.status === "all" ? undefined : and(inArray(actionCard.status, ["OPEN", "IN_PROGRESS"]), isNull(actionCard.resolvedAt)),
    // 銀行・資金のカードは銀行を見られる人だけ
    actor.role === "MANAGER" ? sql`${actionCard.ruleKey} not like 'cash.%'` : undefined,
  ];
  return db
    .select({ c: actionCard, assigneeName: appUser.name })
    .from(actionCard)
    .leftJoin(appUser, eq(appUser.id, actionCard.assigneeId))
    .where(and(...conds))
    .orderBy(asc(actionCard.priority), asc(actionCard.dueDate), asc(actionCard.firstSeenAt))
    .limit(opts.limit ?? 200);
}

export async function setActionStatus(db: DB, actor: Actor, id: string, status: "OPEN" | "IN_PROGRESS" | "DONE" | "DISMISSED") {
  if (!isStaff(actor)) throw forbidden();
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(actionCard).where(eq(actionCard.id, id)).for("update");
    const scope = divisionScope(actor);
    if (!c || (scope && (!c.divisionId || !scope.includes(c.divisionId)))) throw notFound("対応カードが見つかりません");
    if (c.status === status) throw conflict("既にその状態です");
    await tx.update(actionCard).set({ status, updatedById: actor.userId, assigneeId: status === "IN_PROGRESS" ? actor.userId : c.assigneeId }).where(eq(actionCard.id, id));
    await writeAudit(tx, actor, { action: "action_card.status", entityType: "action_card", entityId: id, divisionId: c.divisionId, summary: `対応カード「${c.title}」を${status}に変更` });
  });
}


/* ================================================================== */
/* ルール（根拠の数値はすべてDBの保存データから計算）                   */
/* ================================================================== */

type Finding = {
  ruleKey: string;
  targetKey: string;
  priority: 1 | 2 | 3;
  divisionId: string | null;
  title: string;
  finding: string;
  evidence: { label: string; value: string }[];
  periodLabel: string;
  recommendation: string;
  needsTaxReview?: boolean;
  assigneeRole: "OWNER" | "ACCOUNTING" | "MANAGER";
  dueDate: string | null;
  link: string;
};

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

async function evaluateRules(db: DB, today: string): Promise<Finding[]> {
  const { addDays, addMonths, monthRange } = await import("@/lib/dates");
  const { getSettings } = await import("./masters");
  const s = await getSettings(db);
  const month = today.slice(0, 7);
  const prevMonth = addMonths(month, -1);
  const [, monthEnd] = monthRange(month);
  const out: Finding[] = [];

  // 1. 外注費率（当月・前月）
  for (const m of [prevMonth, month]) {
    const r = await db.execute<{ id: string; name: string; limit_pct: number; sales: number; outsourcing: number }>(sql`
      select d.id, d.name, coalesce(d.outsourcing_ratio_limit, ${s.outsourcingRatioLimit}) limit_pct,
        coalesce((select sum(amount_ex_tax) from sale where division_id = d.id and canceled_at is null and month = ${m}), 0)::float8 sales,
        (coalesce((select sum(e.amount - e.tax_amount) from expense e join expense_category c on c.id = e.category_id
           where e.division_id = d.id and e.status = 'APPROVED' and c.is_outsourcing and e.month = ${m}), 0)
         + coalesce((select sum(case when s.snapshot->>'taxMode' = 'INCLUSIVE' then l.amount - floor(l.amount * 10 / 110) else l.amount end)
           from statement_line l join statement s on s.id = l.statement_id
           where l.division_id = d.id and s.status in ('CONFIRMED','PUBLISHED') and l.kind in ('WORK','ADJUSTMENT') and s.month = ${m}), 0))::float8 outsourcing
      from division d where d.archived_at is null`);
    for (const d of r.rows) {
      if (d.sales <= 0 || d.outsourcing <= 0) continue;
      const ratio = d.outsourcing / d.sales;
      if (ratio * 100 <= d.limit_pct) continue;
      out.push({
        ruleKey: "outsourcing.ratio",
        targetKey: `${d.id}:${m}`,
        priority: ratio > 1 ? 1 : 2,
        divisionId: d.id,
        title: `${d.name}の外注費率が基準を超えています`,
        finding: `${m}の外注費率が ${pct(ratio)} で、設定基準 ${d.limit_pct}% を超えています。`,
        evidence: [{ label: "売上（税抜）", value: yen(d.sales) }, { label: "外注費（税抜）", value: yen(d.outsourcing) }, { label: "外注費率", value: pct(ratio) }, { label: "基準", value: `${d.limit_pct}%` }],
        periodLabel: m,
        recommendation: "対象案件の単価と稼働実績を確認してください。単価の見直しや売上計上漏れがないかも確認が必要です。",
        assigneeRole: "MANAGER",
        dueDate: addDays(today, 7),
        link: `/app/pl/drill?kind=statementCost&from=${m}&to=${m}&division=${d.id}`,
      });
    }
  }

  // 2. 資金余力
  const cash = await db.execute<{ bank: number; accounts: number; pay: number; rec: number }>(sql`
    select coalesce(sum(balance), 0)::float8 bank, count(*)::int accounts,
      (select coalesce(sum(amount), 0) from payable where status = 'SCHEDULED' and due_date <= ${addDays(today, s.cashHorizonDays)})::float8 pay,
      (select coalesce(sum(o.rest), 0) from (select s.expected_receipt_date d, s.amount_ex_tax + s.tax_amount - coalesce((select sum(r.amount) from receipt r where r.sale_id = s.id and r.canceled_at is null), 0) rest from sale s where s.canceled_at is null) o
         where o.rest > 0 and o.d between ${today} and ${addDays(today, s.cashHorizonDays)})::float8 rec
    from bank_account where archived_at is null and balance is not null`);
  const c = cash.rows[0];
  if (c.accounts > 0) {
    const cap = c.bank - c.pay + c.rec;
    const tight = c.bank - c.pay;
    if (cap < s.cashWarningThreshold || tight < s.cashWarningThreshold) {
      out.push({
        ruleKey: "cash.capacity",
        targetKey: "company",
        priority: cap < s.cashWarningThreshold ? 1 : 2,
        divisionId: null,
        title: "支払予定に対して資金余力が低下しています",
        finding: cap < s.cashWarningThreshold ? `今後${s.cashHorizonDays}日の入出金予定を反映した資金余力が ${yen(cap)} で、警告基準 ${yen(s.cashWarningThreshold)} を下回ります。` : `入金予定が遅れた場合、支払後の残高が ${yen(tight)} となり警告基準を下回ります。`,
        evidence: [{ label: "銀行残高の合計", value: yen(c.bank) }, { label: `支払予定（${s.cashHorizonDays}日）`, value: yen(c.pay) }, { label: `入金予定（${s.cashHorizonDays}日）`, value: yen(c.rec) }, { label: "資金余力", value: yen(cap) }],
        periodLabel: `${today}〜${addDays(today, s.cashHorizonDays)}`,
        recommendation: "入金予定（特に期日の近いもの）を顧客に確認し、支払時期を調整できるものがないか確認してください。",
        assigneeRole: "ACCOUNTING",
        dueDate: addDays(today, 3),
        link: "/app/payables",
      });
    }
  }

  // 3. 領収書未添付（当月・前月、月次締め前）
  const nr = await db.execute<{ division_id: string | null; name: string | null; n: number; amount: number }>(sql`
    select e.division_id, d.name, count(*)::int n, sum(e.amount)::float8 amount from expense e left join division d on d.id = e.division_id
    where e.status in ('SUBMITTED','APPROVED') and e.month between ${prevMonth} and ${month}
      and not exists (select 1 from stored_file f where f.owner_type = 'EXPENSE' and f.owner_id = e.id)
      and not exists (select 1 from month_close mc where mc.month = e.month and mc.is_closed)
    group by 1, 2`);
  for (const r of nr.rows) {
    out.push({
      ruleKey: "expense.no_receipt",
      targetKey: r.division_id ?? "common",
      priority: 2,
      divisionId: r.division_id,
      title: `領収書未添付の経費が残っています（${r.name ?? "共通経費"}）`,
      finding: `申請中・承認済みの経費 ${r.n}件 に領収書が添付されていません。`,
      evidence: [{ label: "件数", value: `${r.n}件` }, { label: "合計（税込）", value: yen(r.amount) }],
      periodLabel: `${prevMonth}〜${month}`,
      recommendation: "月次締め前に申請者へ領収書の添付を依頼してください。電子保存の要件など税務上の扱いは税理士に確認してください。",
      needsTaxReview: true,
      assigneeRole: r.division_id ? "MANAGER" : "ACCOUNTING",
      dueDate: monthEnd,
      link: `/app/expenses?noReceipt=1${r.division_id ? `&division=${r.division_id}` : "&division=COMMON"}`,
    });
  }

  // 4. 予算超過・超過見込み（当月）
  const { listBudgetStatus } = await import("./budget");
  const sys: Actor = { userId: "00000000-0000-0000-0000-000000000000", name: "システム", email: null, role: "OWNER", divisionIds: [], demo: false };
  for (const e of await listBudgetStatus(db, sys, month)) {
    const over = e.available < 0;
    const willOver = !over && e.forecast !== null && e.forecast > e.cap && e.cap > 0;
    if (!over && !willOver) continue;
    out.push({
      ruleKey: "budget.over",
      targetKey: `${e.rule.id}:${month}`,
      priority: over ? 1 : 2,
      divisionId: e.rule.divisionId,
      title: over ? `予算「${e.scopeLabel}」を超過しています` : `予算「${e.scopeLabel}」が月末に超過する見込みです`,
      finding: over ? `利用可能額が ${yen(e.available)} です（社内ルール上の予算。銀行残高とは別の指標です）。` : `現在のペースでは月末に ${yen(e.forecast!)} となり、上限 ${yen(e.cap)} を超える見込みです。`,
      evidence: [{ label: "上限", value: yen(e.cap) }, { label: "使用済み", value: yen(e.used) }, { label: "予約済み", value: yen(e.reserved) }, { label: "利用可能額", value: yen(e.available) }, ...(e.forecast !== null ? [{ label: "月末見込み", value: yen(e.forecast) }] : [])],
      periodLabel: e.periodLabel,
      recommendation: over ? "今後の支出を抑えるか、必要であれば予算追加申請を行ってください（予算の変更は人が承認します）。" : "支出計画を確認し、必要なら早めに予算追加申請を行ってください。",
      assigneeRole: e.rule.divisionId ? "MANAGER" : "ACCOUNTING",
      dueDate: addDays(today, 5),
      link: `/app/budget?month=${month}`,
    });
  }

  // 5. 入金予定日を過ぎた未収金
  const od = await db.execute<{ division_id: string; name: string; n: number; rest: number; oldest: string }>(sql`
    with o as (select s.division_id, s.expected_receipt_date d, s.amount_ex_tax + s.tax_amount - coalesce((select sum(r.amount) from receipt r where r.sale_id = s.id and r.canceled_at is null), 0) rest
      from sale s where s.canceled_at is null and s.expected_receipt_date < ${today})
    select o.division_id, d.name, count(*)::int n, sum(rest)::float8 rest, min(o.d)::text oldest from o join division d on d.id = o.division_id where rest > 0 group by 1, 2`);
  for (const r of od.rows) {
    out.push({
      ruleKey: "receivable.overdue",
      targetKey: r.division_id,
      priority: 1,
      divisionId: r.division_id,
      title: `${r.name}に入金予定日を過ぎた未収金があります`,
      finding: `入金予定日を過ぎても入金が確認できない売上が ${r.n}件 あります。`,
      evidence: [{ label: "件数", value: `${r.n}件` }, { label: "未収残高（税込）", value: yen(r.rest) }, { label: "最も古い入金予定日", value: r.oldest }],
      periodLabel: `${r.oldest}〜${today}`,
      recommendation: "銀行の入金を照合し、未入金なら顧客に入金状況を確認してください。",
      assigneeRole: "ACCOUNTING",
      dueDate: addDays(today, 3),
      link: `/app/sales?status=unpaid&division=${r.division_id}`,
    });
  }

  // 6. 支払期日を過ぎた支払予定
  const po = await db.execute<{ n: number; amount: number; oldest: string }>(sql`select count(*)::int n, coalesce(sum(amount), 0)::float8 amount, min(due_date)::text oldest from payable where status = 'SCHEDULED' and due_date < ${today}`);
  if (po.rows[0].n > 0) {
    out.push({
      ruleKey: "payable.overdue",
      targetKey: "company",
      priority: 1,
      divisionId: null,
      title: "支払予定日を過ぎた支払があります",
      finding: `支払予定日を過ぎて「支払済み」になっていない支払が ${po.rows[0].n}件 あります。`,
      evidence: [{ label: "件数", value: `${po.rows[0].n}件` }, { label: "合計", value: yen(po.rows[0].amount) }, { label: "最も古い予定日", value: po.rows[0].oldest }],
      periodLabel: `${po.rows[0].oldest}〜${today}`,
      recommendation: "支払済みであれば銀行の出金と照合し、未払いなら支払手続きを確認してください（このシステムは送金を行いません）。",
      assigneeRole: "ACCOUNTING",
      dueDate: today,
      link: "/app/payables",
    });
  }

  // 7. 未提出の日報
  const mr = await db.execute<{ division_id: string; name: string; n: number }>(sql`
    select p.division_id, d.name, count(*)::int n from assignment a join shift_slot sl on sl.id = a.slot_id join project p on p.id = sl.project_id join division d on d.id = p.division_id
    where a.status = 'CONFIRMED' and a.work_date < ${today} and a.work_date >= ${addDays(today, -31)}
      and not exists (select 1 from daily_report r where r.driver_id = a.driver_id and r.project_id = sl.project_id and r.work_date = a.work_date and r.status <> 'DRAFT')
    group by 1, 2`);
  for (const r of mr.rows) {
    out.push({
      ruleKey: "report.missing",
      targetKey: r.division_id,
      priority: 2,
      divisionId: r.division_id,
      title: `${r.name}で未提出の日報があります`,
      finding: `確定した稼働のうち ${r.n}件 の日報が提出されていません。稼働明細は承認済みの日報からのみ作成されます。`,
      evidence: [{ label: "未提出", value: `${r.n}件` }],
      periodLabel: `${addDays(today, -31)}〜${addDays(today, -1)}`,
      recommendation: "該当ドライバーに日報の提出を依頼してください。",
      assigneeRole: "MANAGER",
      dueDate: addDays(today, 2),
      link: "/app/reports?missing=1",
    });
  }

  // 8. 稼働希望の未提出（締切が近い・過ぎた受付期間）
  const av = await db.execute<{ month: string; deadline: Date; division_id: string; name: string; n: number }>(sql`
    select p.month, p.deadline, d.id division_id, d.name,
      (select count(*) from driver dr join app_user u on u.id = dr.user_id where u.status = 'ACTIVE' and dr.division_id = d.id
        and not exists (select 1 from availability_submission x where x.driver_id = dr.user_id and x.month = p.month and x.status = 'SUBMITTED'))::int n
    from availability_period p join division d on d.kind = 'DRIVER' and (p.division_id is null or p.division_id = d.id)
    where p.status = 'OPEN' and p.deadline < ${addDays(today, 4)}::date + interval '1 day'`);
  for (const r of av.rows.filter((x) => x.n > 0)) {
    out.push({
      ruleKey: "availability.unsubmitted",
      targetKey: `${r.division_id}:${r.month}`,
      priority: 2,
      divisionId: r.division_id,
      title: `${r.month}の稼働希望が未提出のドライバーがいます`,
      finding: `締切（${r.deadline.toISOString().slice(0, 10)}）が近い、または過ぎていますが、${r.n}人 が未提出です。`,
      evidence: [{ label: "未提出", value: `${r.n}人` }],
      periodLabel: r.month,
      recommendation: "リマインドメールの送信状況を確認し、必要なら個別に連絡してください。",
      assigneeRole: "MANAGER",
      dueDate: r.deadline.toISOString().slice(0, 10),
      link: `/app/shifts?month=${r.month}`,
    });
  }

  // 9. 前月の稼働明細が未確定
  const su = await db.execute<{ n: number; drivers: number }>(sql`
    select count(*)::int n, (select count(distinct r.driver_id) from daily_report r where r.status = 'APPROVED' and to_char(r.work_date, 'YYYY-MM') = ${prevMonth}
      and not exists (select 1 from statement s where s.driver_id = r.driver_id and s.month = ${prevMonth} and s.status <> 'SUPERSEDED'))::int drivers
    from statement where month = ${prevMonth} and status in ('DRAFT','REVIEW')`);
  if (su.rows[0].n + su.rows[0].drivers > 0) {
    out.push({
      ruleKey: "statement.unconfirmed",
      targetKey: prevMonth,
      priority: 2,
      divisionId: null,
      title: `${prevMonth}の稼働明細が確定していません`,
      finding: `下書き・確認中の明細が ${su.rows[0].n}件、明細未作成のドライバーが ${su.rows[0].drivers}人 います。`,
      evidence: [{ label: "未確定", value: `${su.rows[0].n}件` }, { label: "未作成", value: `${su.rows[0].drivers}人` }],
      periodLabel: prevMonth,
      recommendation: "承認済みの日報を確認して明細を生成・確定し、支払予定日までに公開してください。",
      assigneeRole: "ACCOUNTING",
      dueDate: addDays(today, 5),
      link: `/app/statements?month=${prevMonth}`,
    });
  }

  // 10. 契約の更新期限
  const ct = await db.execute<{ id: string; title: string; division_id: string; period_end: string; days: number }>(sql`
    select id, title, division_id, period_end::text, renewal_notice_days days from contract
    where status = 'SIGNED' and period_end is not null and period_end <= ${today}::date + renewal_notice_days and period_end >= ${addDays(today, -30)}`);
  for (const r of ct.rows) {
    out.push({
      ruleKey: "contract.renewal",
      targetKey: r.id,
      priority: r.period_end < today ? 1 : 2,
      divisionId: r.division_id,
      title: `契約「${r.title}」の更新期限が近づいています`,
      finding: `契約期間の終了日は ${r.period_end} です（通知: ${r.days}日前から）。`,
      evidence: [{ label: "終了日", value: r.period_end }],
      periodLabel: `〜${r.period_end}`,
      recommendation: "更新・条件変更・終了のいずれかを決め、必要なら契約書の改訂版を作成してください（締結は人が行います）。",
      assigneeRole: "MANAGER",
      dueDate: r.period_end,
      link: `/app/contracts/${r.id}`,
    });
  }

  // 11. 銀行同期の失敗・未照合の取引
  const bf = await db.execute<{ id: string; bank_name: string; last_error: string | null }>(sql`select id, bank_name, last_error from bank_account where archived_at is null and sync_status = 'FAILED'`);
  for (const r of bf.rows) {
    out.push({
      ruleKey: "cash.sync_failed",
      targetKey: r.id,
      priority: 1,
      divisionId: null,
      title: `${r.bank_name}の口座同期に失敗しています`,
      finding: `最新の残高・取引が取得できていません。${r.last_error ?? ""}`,
      evidence: [{ label: "口座", value: r.bank_name }],
      periodLabel: today,
      recommendation: "銀行連携の設定を確認して再同期するか、CSVを取り込んでください。",
      assigneeRole: "ACCOUNTING",
      dueDate: today,
      link: "/app/bank",
    });
  }
  const um = await db.execute<{ n: number; total: number }>(sql`
    select count(*)::int n, coalesce(sum(abs(amount)), 0)::float8 total from bank_transaction t
    where t.txn_date < ${addDays(today, -3)} and t.classification in ('UNCLASSIFIED','SALES_RECEIPT','EXPENSE_PAYMENT','STATEMENT_PAYMENT')
      and not exists (select 1 from bank_match m where m.transaction_id = t.id and m.unmatched_at is null)`);
  if (um.rows[0].n > 0) {
    out.push({
      ruleKey: "cash.unmatched",
      targetKey: "company",
      priority: 3,
      divisionId: null,
      title: "照合されていない銀行取引があります",
      finding: `入金・支払と紐付いていない取引が ${um.rows[0].n}件 あります。`,
      evidence: [{ label: "件数", value: `${um.rows[0].n}件` }, { label: "金額の合計", value: yen(um.rows[0].total) }],
      periodLabel: `〜${addDays(today, -3)}`,
      recommendation: "照合候補を確認して紐付けるか、振替・借入・税金などの区分を設定してください。",
      assigneeRole: "ACCOUNTING",
      dueDate: addDays(today, 7),
      link: "/app/bank?view=unmatched",
    });
  }

  // 12. 源泉徴収の要否が未確認の個人ドライバー（税務は要確認）
  const wh = await db.execute<{ division_id: string; name: string; n: number }>(sql`
    select d.division_id, dv.name, count(*)::int n from driver d join app_user u on u.id = d.user_id join division dv on dv.id = d.division_id
    left join partner p on p.id = d.partner_id
    where u.status = 'ACTIVE' and coalesce(p.type, 'INDIVIDUAL') = 'INDIVIDUAL' and not d.withholding_enabled and coalesce(d.withholding_confirmed_note, '') = ''
    group by 1, 2`);
  for (const r of wh.rows) {
    out.push({
      ruleKey: "tax.withholding_unconfirmed",
      targetKey: r.division_id,
      priority: 3,
      divisionId: r.division_id,
      title: "源泉徴収の要否が未確認の委託先があります（要確認）",
      finding: `個人の委託先 ${r.n}人 について、源泉徴収の要否の確認記録がありません。稼働明細では源泉徴収を計算していません。`,
      evidence: [{ label: "対象", value: `${r.n}人` }],
      periodLabel: today.slice(0, 7),
      recommendation: "業務内容に応じた源泉徴収の要否を税理士に確認し、ドライバー設定に確認結果を記録してください（社内予算のルールとは別の判断です）。",
      needsTaxReview: true,
      assigneeRole: "ACCOUNTING",
      dueDate: null,
      link: "/app/drivers",
    });
  }
  return out;
}

/** ルールを実行し、カードを作成・更新・自動解消する（何度実行しても重複しない） */
export async function refreshActionCards(db: DB, actor?: Actor, now = new Date()) {
  if (actor && !isStaff(actor)) throw forbidden();
  const { todayJst } = await import("@/lib/dates");
  const today = todayJst(now);
  const findings = await evaluateRules(db, today);
  const { polishCardText } = await import("@/adapters/llm");
  let created = 0;
  let resolved = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('action_cards'))`);
    const seen = new Set<string>();
    for (const f of findings) {
      seen.add(`${f.ruleKey}|${f.targetKey}`);
      const [cur] = await tx.select().from(actionCard).where(and(eq(actionCard.ruleKey, f.ruleKey), eq(actionCard.targetKey, f.targetKey))).limit(1);
      const text = await polishCardText(f);
      const values = { ...f, finding: text.finding, recommendation: text.recommendation, textSource: text.source, needsTaxReview: !!f.needsTaxReview, lastSeenAt: now };
      if (!cur) {
        await tx.insert(actionCard).values({ ...values, firstSeenAt: now });
        created++;
      } else {
        const reopen = cur.resolvedAt !== null;
        await tx.update(actionCard).set({ ...values, resolvedAt: null, status: reopen ? "OPEN" : cur.status }).where(eq(actionCard.id, cur.id));
        if (reopen) created++;
      }
    }
    const active = await tx.select({ id: actionCard.id, ruleKey: actionCard.ruleKey, targetKey: actionCard.targetKey }).from(actionCard).where(isNull(actionCard.resolvedAt));
    for (const a of active) {
      if (!seen.has(`${a.ruleKey}|${a.targetKey}`)) {
        await tx.update(actionCard).set({ resolvedAt: now }).where(eq(actionCard.id, a.id));
        resolved++;
      }
    }
  });
  return { created, resolved, total: findings.length };
}

let lastLocalRefresh = 0;
/** 画面表示時に、前回の更新から15分以上たっていればカードを更新（定期処理がない環境でも最新に保つ） */
export async function refreshIfStale(db: DB, now = new Date()) {
  if (now.getTime() - lastLocalRefresh < 60_000) return;
  lastLocalRefresh = now.getTime();
  try {
    const [{ last }] = (await db.execute<{ last: string | null }>(sql`select max(last_seen_at)::text last from action_card`)).rows;
    if (last && now.getTime() - new Date(last.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime() < 15 * 60_000) return;
    await refreshActionCards(db, undefined, now);
  } catch (e) {
    console.error("[cards-refresh]", e instanceof Error ? e.name : "unknown");
  }
}
