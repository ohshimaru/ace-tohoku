import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { allocationRule, allocationShare, companySetting, expense, payable } from "@/db/schema";
import type { Actor } from "@/lib/access";
import { addCommitment, cancelCommitment, decideBudgetRequest, listBudgetStatus, requestBudget, saveRule } from "@/server/budget";
import { approveExpense, cancelExpense, createExpense, getExpense, listExpenses, rejectExpense, returnExpense, submitExpense, updateExpense } from "@/server/expenses";
import { getCashPosition, getPL } from "@/server/metrics";
import { closeMonth, reopenMonth } from "@/server/months";
import { getPartner, listPartners, savePartner, saveProject, getProject } from "@/server/partners";
import { addReceipt, createSale, getSale, listSales } from "@/server/sales";
import { makeCategory, makeDivision, makeUser, resetDb } from "./helpers/db";

let owner: Actor, acct: Actor, mgrSns: Actor, mgrClean: Actor, drv: Actor;
let dSns = "", dDrv = "", dClean = "", catAd = "", catTool = "", catOut = "", catRent = "";
let custA = "", custB = "", projSns = "", projClean = "";
const M = "2026-10";

beforeAll(async () => {
  await resetDb();
  dSns = await makeDivision("SNS", "SNS・AI開発事業部");
  dDrv = await makeDivision("DRV", "業務委託事業部", "DRIVER");
  dClean = await makeDivision("CLN", "清掃事業部", "CLEANING");
  catAd = await makeCategory("広告費");
  catTool = await makeCategory("ツール費");
  catOut = await makeCategory("外注費", true);
  catRent = await makeCategory("地代家賃");
  owner = await makeUser("代表", "OWNER");
  acct = await makeUser("経理", "ACCOUNTING");
  mgrSns = await makeUser("SNS責任者", "MANAGER", { divisionIds: [dSns] });
  mgrClean = await makeUser("清掃責任者", "MANAGER", { divisionIds: [dClean] });
  drv = await makeUser("ドライバーA", "DRIVER", { driverDivisionId: dDrv });
  const db = getDb();
  custA = await savePartner(db, owner, null, { type: "CORPORATION", name: "株式会社サンプルA", isCustomer: true, isContractor: false, divisionIds: [dSns] });
  custB = await savePartner(db, owner, null, { type: "CORPORATION", name: "清掃顧客B", isCustomer: true, isContractor: true, divisionIds: [dClean] });
  projSns = await saveProject(db, owner, null, { code: "SNS-001", name: "SNS運用", divisionId: dSns, customerId: custA, category: "SNS運用", contractType: "MONTHLY", amount: "300000", status: "ACTIVE" });
  projClean = await saveProject(db, owner, null, { code: "CLN-001", name: "定期清掃", divisionId: dClean, customerId: custB, category: "清掃", contractType: "MONTHLY", amount: "200000", status: "ACTIVE" });
});
afterAll(closeDb);

describe("権限分離", () => {
  it("責任者は担当外の事業部の取引先・案件・売上・経費を見られない", async () => {
    const db = getDb();
    await expect(getPartner(db, mgrSns, custB)).rejects.toThrow(/見つかりません/);
    await expect(getProject(db, mgrSns, projClean)).rejects.toThrow(/見つかりません/);
    const list = await listPartners(db, mgrSns);
    expect(list.rows.map((r) => r.name)).toEqual(["株式会社サンプルA"]);
    const s = await createSale(db, mgrClean, { recognizedOn: "2026-10-05", divisionId: dClean, projectId: projClean, description: "定期清掃10月", amountExTax: "200000", taxRate: 10 });
    expect((await listSales(db, mgrSns)).rows.map((r) => r.id)).not.toContain(s);
    await expect(getSale(db, mgrSns, s)).rejects.toThrow(/見つかりません/);
    await expect(createSale(db, mgrSns, { recognizedOn: "2026-10-05", divisionId: dClean, description: "x", amountExTax: "1", taxRate: 10 })).rejects.toThrow(/担当外/);
  });

  it("責任者・ドライバーは銀行残高（資金）を見られない", async () => {
    await expect(getCashPosition(getDb(), mgrSns)).rejects.toThrow(/経営者・経理/);
    await expect(getCashPosition(getDb(), drv)).rejects.toThrow();
    await expect(getCashPosition(getDb(), acct)).resolves.toBeTruthy();
  });

  it("責任者は共通経費（全社）を登録できず、損益も担当事業部のみ", async () => {
    const db = getDb();
    await expect(createExpense(db, mgrSns, { usedOn: "2026-10-02", categoryId: catRent, payee: "大家", purpose: "家賃", amount: "110000", taxRate: 10 })).rejects.toThrow(/共通経費/);
    const pl = await getPL(db, mgrSns, { from: M, to: M });
    expect(pl.rows.map((r) => r.name)).toEqual(["SNS・AI開発事業部"]);
    expect(pl.totals.commonTotal).toBeNull();
    await expect(getPL(db, mgrSns, { from: M, to: M, divisionId: dClean })).rejects.toThrow(/担当外/);
  });

  it("ドライバーは他人の経費を見られず、所属外の事業部で申請できない", async () => {
    const db = getDb();
    const own = await createExpense(db, drv, { usedOn: "2026-10-03", divisionId: dDrv, categoryId: catTool, payee: "ガソリンスタンド", purpose: "燃料", amount: "3300", taxRate: 10, settlement: "STATEMENT" });
    const other = await createExpense(db, mgrSns, { usedOn: "2026-10-03", divisionId: dSns, categoryId: catTool, payee: "SaaS", purpose: "ツール", amount: "1100", taxRate: 10 });
    await expect(getExpense(db, drv, other)).rejects.toThrow(/見つかりません/);
    expect((await listExpenses(db, drv)).rows.map((r) => r.id)).toEqual([own]);
    await expect(createExpense(db, drv, { usedOn: "2026-10-03", divisionId: dSns, categoryId: catTool, payee: "x", purpose: "x", amount: "100", taxRate: 10, settlement: "STATEMENT" })).rejects.toThrow(/所属事業部/);
  });
});

describe("予算: 予約額と実績の二重控除を防ぐ", () => {
  let ruleAd = "";
  it("ルールから上限を算出（固定＋売上連動）", async () => {
    const db = getDb();
    await createSale(db, owner, { recognizedOn: "2026-09-10", divisionId: dSns, projectId: projSns, description: "9月分", amountExTax: "300000", taxRate: 10 });
    ruleAd = await saveRule(db, owner, null, {
      name: "SNS広告費",
      divisionId: dSns,
      categoryId: catAd,
      period: "MONTH",
      fixedAmount: "50000",
      perHeadAmount: "0",
      headcountBasis: "DIVISION_DRIVERS",
      base: "SALES",
      basePercent: "10",
      baseWindow: "PREV",
      carryOver: false,
      effectiveFrom: "2026-04-01",
      overAction: "BLOCK",
      priority: "0",
    });
    const st = await listBudgetStatus(db, mgrSns, M);
    const env = st.find((e) => e.rule.id === ruleAd)!;
    expect(env.cap).toBe(80000); // 50,000 + 前月売上300,000×10%
    expect(env.available).toBe(80000);
  });

  it("申請中は予約、承認で実績へ移り、二重に引かれない", async () => {
    const db = getDb();
    const id = await createExpense(db, mgrSns, { usedOn: "2026-10-10", divisionId: dSns, projectId: projSns, categoryId: catAd, payee: "広告媒体", purpose: "SNS広告", amount: "30000", taxRate: 10 });
    await submitExpense(db, mgrSns, id);
    let env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect([env.used, env.reserved, env.available]).toEqual([0, 30000, 50000]);
    await expect(approveExpense(db, mgrSns, id)).rejects.toThrow(/自分の申請/);
    await approveExpense(db, owner, id);
    env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect([env.used, env.reserved, env.available]).toEqual([30000, 0, 50000]);
  });

  it("差戻し・却下・取消で予約から外れる", async () => {
    const db = getDb();
    const a = await createExpense(db, mgrSns, { usedOn: "2026-10-11", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "広告", amount: "10000", taxRate: 10 });
    const b = await createExpense(db, mgrSns, { usedOn: "2026-10-11", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "広告", amount: "5000", taxRate: 10 });
    const c = await createExpense(db, mgrSns, { usedOn: "2026-10-11", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "広告", amount: "2000", taxRate: 10 });
    for (const x of [a, b, c]) await submitExpense(db, mgrSns, x);
    let env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect(env.reserved).toBe(17000);
    await returnExpense(db, owner, a, "領収書がありません");
    await rejectExpense(db, owner, b, "対象外");
    await cancelExpense(db, mgrSns, c, "誤登録");
    env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect([env.used, env.reserved, env.available]).toEqual([30000, 0, 50000]);
  });

  it("発注済み費用は予約に入り、経費の承認で消化（二重控除なし）、取消で戻る", async () => {
    const db = getDb();
    const cm = await addCommitment(db, mgrSns, { divisionId: dSns, categoryId: catAd, description: "11月掲載枠", amount: "20000", orderedOn: "2026-10-12" });
    let env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect([env.reserved, env.available]).toEqual([20000, 30000]);
    const e = await createExpense(db, mgrSns, { usedOn: "2026-10-13", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "掲載", amount: "20000", taxRate: 10, commitmentId: cm });
    await submitExpense(db, mgrSns, e);
    env = (await listBudgetStatus(db, owner, M)).find((e2) => e2.rule.id === ruleAd)!;
    // 申請中の経費(20,000)と発注(20,000)が両方予約に入る → 発注に紐付いた経費は承認で発注を消化
    await approveExpense(db, owner, e);
    env = (await listBudgetStatus(db, owner, M)).find((e2) => e2.rule.id === ruleAd)!;
    expect([env.used, env.reserved, env.available]).toEqual([50000, 0, 30000]);
    const cm2 = await addCommitment(db, mgrSns, { divisionId: dSns, categoryId: catAd, description: "取消予定", amount: "5000", orderedOn: "2026-10-12" });
    await cancelCommitment(db, mgrSns, cm2);
    env = (await listBudgetStatus(db, owner, M)).find((e2) => e2.rule.id === ruleAd)!;
    expect(env.available).toBe(30000);
  });

  it("申請制限ルールを超える申請は拒否、例外申請は経営者のみ承認できる", async () => {
    const db = getDb();
    const big = await createExpense(db, mgrSns, { usedOn: "2026-10-14", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "大型広告", amount: "40000", taxRate: 10 });
    await expect(submitExpense(db, mgrSns, big)).rejects.toThrow(/申請制限/);
    const check = await submitExpense(db, mgrSns, big, { exceptionReason: "キャンペーンのため" });
    expect(check.blocked).toBe(true);
    await expect(approveExpense(db, acct, big)).rejects.toThrow(/例外承認/);
    await approveExpense(db, owner, big);
    const env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect(env.available).toBe(-10000);
  });

  it("予算追加申請の承認で上限が増える（自己承認は不可）", async () => {
    const db = getDb();
    const r = await requestBudget(db, mgrSns, { divisionId: dSns, categoryId: catAd, month: M, amount: "15000", reason: "追加施策" });
    await decideBudgetRequest(db, owner, r, true, "");
    const env = (await listBudgetStatus(db, owner, M)).find((e) => e.rule.id === ruleAd)!;
    expect(env.cap).toBe(95000);
    expect(env.available).toBe(5000);
    expect(env.basis.some((b) => b.label === "承認済みの予算追加")).toBe(true);
  });

  it("同時申請でも予算をすり抜けない", async () => {
    const db = getDb();
    const a = await createExpense(db, mgrSns, { usedOn: "2026-10-15", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "a", amount: "4000", taxRate: 10 });
    const b = await createExpense(db, mgrSns, { usedOn: "2026-10-15", divisionId: dSns, categoryId: catAd, payee: "媒体", purpose: "b", amount: "4000", taxRate: 10 });
    const r = await Promise.allSettled([submitExpense(db, mgrSns, a), submitExpense(db, mgrSns, b)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1); // 残り5,000円に4,000円×2は入らない
  });
});

describe("経費: 二重計上・二重払いを防ぐ", () => {
  it("承認済み経費は1回だけ集計し、支払予定も1件だけ", async () => {
    const db = getDb();
    const id = await createExpense(db, acct, { usedOn: "2026-10-20", categoryId: catRent, payee: "大家", purpose: "10月家賃", amount: "110000", taxRate: 10, settlement: "COMPANY_PAID" });
    await submitExpense(db, acct, id);
    const r = await Promise.allSettled([approveExpense(db, owner, id), approveExpense(db, owner, id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const pays = await db.select().from(payable).where(sql`${payable.sourceId} = ${id}`);
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(110000);
    // 承認済みのまま再度支払予定を作ろうとしても一意制約で拒否
    await expect(db.insert(payable).values({ source: "EXPENSE", sourceId: id, payeeName: "x", description: "x", amount: 1, dueDate: "2026-11-30" })).rejects.toThrow();
  });

  it("自己承認はDB制約でも拒否", async () => {
    const db = getDb();
    const id = await createExpense(db, owner, { usedOn: "2026-10-20", divisionId: dSns, categoryId: catTool, payee: "x", purpose: "x", amount: "100", taxRate: 10 });
    await submitExpense(db, owner, id);
    await expect(approveExpense(db, owner, id)).rejects.toThrow(/自分の申請/);
    await expect(db.update(expense).set({ status: "APPROVED", decidedById: owner.userId }).where(sql`${expense.id} = ${id}`)).rejects.toThrow();
  });
});

describe("共通経費の配賦（全社で二重計上しない）", () => {
  it("売上比で配賦し、全社合計では共通経費を1回だけ数える", async () => {
    const db = getDb();
    const [r] = await db.insert(allocationRule).values({ name: "売上比", method: "SALES_RATIO", effectiveFrom: "2026-04" }).returning();
    void r;
    const pl = await getPL(db, owner, { from: M, to: M });
    const sns = pl.rows.find((x) => x.divisionId === dSns)!;
    const cln = pl.rows.find((x) => x.divisionId === dClean)!;
    const drvRow = pl.rows.find((x) => x.divisionId === dDrv)!;
    // 共通経費: 家賃 110,000（税込）→ 税抜 100,000。10月売上は清掃200,000のみ → 全額を清掃へ
    expect(pl.totals.commonTotal).toBe(100000);
    expect(cln.allocatedCommon).toBe(100000);
    expect(sns.allocatedCommon + drvRow.allocatedCommon).toBe(0);
    const sumDivProfit = pl.rows.reduce((s, x) => s + x.profit, 0);
    expect(pl.totals.profit).toBe(sumDivProfit - (pl.totals.unallocatedCommon ?? 0));
    expect(pl.totals.profit).toBe(pl.totals.sales - pl.totals.directCost - 100000);
  });

  it("固定割合（合計100%未満）は残りを未配賦として残す", async () => {
    const db = getDb();
    const [r] = await db.insert(allocationRule).values({ name: "固定", method: "FIXED_RATIO", effectiveFrom: "2026-10", priority: 10 }).returning();
    await db.insert(allocationShare).values([{ ruleId: r.id, divisionId: dSns, ratioBp: 3000 }, { ruleId: r.id, divisionId: dClean, ratioBp: 3000 }]);
    const pl = await getPL(db, owner, { from: M, to: M });
    expect(pl.rows.find((x) => x.divisionId === dSns)!.allocatedCommon).toBe(30000);
    expect(pl.rows.find((x) => x.divisionId === dClean)!.allocatedCommon).toBe(30000);
    expect(pl.totals.unallocatedCommon).toBe(40000);
    expect(pl.totals.allocatedCommon + pl.totals.unallocatedCommon!).toBe(pl.totals.commonTotal);
  });
});

describe("月次締め", () => {
  it("締めた月は売上・経費・入金を変更できず、解除後は変更できる", async () => {
    const db = getDb();
    const s = await createSale(db, owner, { recognizedOn: "2026-08-20", divisionId: dSns, description: "8月分", amountExTax: "100000", taxRate: 10 });
    const e = await createExpense(db, mgrSns, { usedOn: "2026-08-21", divisionId: dSns, categoryId: catTool, payee: "x", purpose: "x", amount: "1000", taxRate: 10 });
    await closeMonth(db, acct, "2026-08");
    await expect(createSale(db, owner, { recognizedOn: "2026-08-25", divisionId: dSns, description: "後から", amountExTax: "1", taxRate: 10 })).rejects.toThrow(/月次締め済み/);
    await expect(submitExpense(db, mgrSns, e)).rejects.toThrow(/月次締め済み/);
    await expect(updateExpense(db, mgrSns, e, { usedOn: "2026-10-01", divisionId: dSns, categoryId: catTool, payee: "x", purpose: "x", amount: "1000", taxRate: 10 })).rejects.toThrow(/月次締め済み/);
    await expect(addReceipt(db, acct, { saleId: s, receivedOn: "2026-08-31", amount: "110000", idempotencyKey: "rcpt-0831-xxxx" })).rejects.toThrow(/月次締め済み/);
    // 9月の入金は登録可能（締めは月単位）
    await addReceipt(db, acct, { saleId: s, receivedOn: "2026-09-30", amount: "110000", idempotencyKey: "rcpt-0930-xxxx" });
    await expect(closeMonth(db, mgrSns, "2026-09")).rejects.toThrow(/経営者・経理/);
    await reopenMonth(db, acct, "2026-08", "請求漏れの訂正");
    await submitExpense(db, mgrSns, e);
  });
});

describe("会社設定", () => {
  it("予約額に申請中の経費を含めない設定にできる", async () => {
    const db = getDb();
    await db.update(companySetting).set({ reserveSubmittedExpenses: false });
    const st = await listBudgetStatus(db, owner, M);
    expect(st.every((e) => !e.basis.some((b) => b.label === "予約: 申請中の経費"))).toBe(true);
    await db.update(companySetting).set({ reserveSubmittedExpenses: true });
  });
});
