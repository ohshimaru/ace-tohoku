/**
 * デモデータ（架空）の投入: pnpm db:seed-demo
 * - 先に pnpm db:seed（初期データ）を実行してください
 * - 実データの入った本番では実行しないでください。本番ビルドの環境では DEMO_SEED_ALLOW=yes が必要です
 * - すべて架空の会社・人物・取引です。投入後は画面上部に「デモデータ」と表示されます
 * - デモ用アカウントのメールは @demo.invalid（実在しないドメイン）で、パスワードはありません（デモログイン専用）
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { appUser, availabilityPeriod, companySetting, division, driver, expenseCategory, userDivision } from "@/db/schema";
import type { Actor, Role } from "@/lib/access";
import { addDays, addMonths, currentMonthJst, monthRange, todayJst } from "@/lib/dates";
import { refreshActionCards } from "@/server/actions-engine";
import { createBankAccount, syncBankAccount } from "@/server/bank";
import { saveRule } from "@/server/budget";
import { approveTemplate, createContract, listTemplates, setContractStatus } from "@/server/contracts";
import { approveExpense, createExpense, submitExpense } from "@/server/expenses";
import { saveAllocationRule } from "@/server/masters";
import { savePartner, saveProject } from "@/server/partners";
import { approveReport, saveMyReport } from "@/server/reports";
import { addReceipt, createSale } from "@/server/sales";
import { autoAssign, closePeriod, confirmAssignments, createSlots, openPeriod, saveMyAvailability, submitMyAvailability } from "@/server/shifts";
import { addRate, generateForDivision, listStatements, setStatementStatus } from "@/server/statements";

const D = "@demo.invalid";

async function user(name: string, email: string, role: Role, divisionIds: string[] = []): Promise<Actor> {
  const db = getDb();
  const [u] = await db.insert(appUser).values({ name, email: `${email}${D}`, role, status: "ACTIVE", emailVerifiedAt: new Date() }).returning();
  for (const d of divisionIds) await db.insert(userDivision).values({ userId: u.id, divisionId: d });
  return { userId: u.id, name, email: u.email, role, divisionIds: role === "MANAGER" ? divisionIds : [], demo: true };
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ALLOW !== "yes") throw new Error("本番ビルドの環境ではデモデータを投入しません（デモ専用の環境なら DEMO_SEED_ALLOW=yes を指定）");
  const db = getDb();
  const [s] = await db.select().from(companySetting).limit(1);
  if (s?.demoDataLoadedAt) {
    console.log("デモデータは投入済みです（何もしませんでした）");
    return;
  }
  const divs = await db.select().from(division);
  const sns = divs.find((d) => d.code === "SNS")?.id;
  const drv = divs.find((d) => d.code === "DRV")?.id;
  const cln = divs.find((d) => d.code === "CLN")?.id;
  if (!sns || !drv || !cln) throw new Error("初期データがありません。先に pnpm db:seed を実行してください");
  const cats = Object.fromEntries((await db.select().from(expenseCategory)).map((c) => [c.name, c.id]));
  const today = todayJst();
  const cur = currentMonthJst();
  const prev = addMonths(cur, -1);
  const next = addMonths(cur, 1);

  // 利用者
  const owner = await user("代表 太郎（デモ）", "owner", "OWNER");
  const acct = await user("経理 花子（デモ）", "accounting", "ACCOUNTING");
  const mSns = await user("SNS 責任者（デモ）", "sns-manager", "MANAGER", [sns]);
  const mDrv = await user("委託 責任者（デモ）", "driver-manager", "MANAGER", [drv]);
  const mCln = await user("清掃 責任者（デモ）", "cleaning-manager", "MANAGER", [cln]);
  await db.update(companySetting).set({ companyName: "株式会社エースナンバー東北（デモ）", cleanupUrl: "" });

  // 取引先・案件
  const p = (name: string, o: { customer?: boolean; contractor?: boolean; divisionIds: string[] }) => savePartner(db, owner, null, { type: "CORPORATION", name, isCustomer: !!o.customer, isContractor: !!o.contractor, divisionIds: o.divisionIds });
  const cMirai = await p("株式会社みらい商事（デモ）", { customer: true, divisionIds: [sns] });
  const cLogi = await p("東北ロジサービス株式会社（デモ）", { customer: true, divisionIds: [drv] });
  const cBuild = await p("杜の都ビル管理株式会社（デモ）", { customer: true, divisionIds: [cln] });
  const kYamada = await p("山田デザイン事務所（デモ）", { contractor: true, divisionIds: [sns] });
  const pr = (code: string, name: string, divisionId: string, customerId: string, extra: Record<string, unknown> = {}) => saveProject(db, owner, null, { code, name, divisionId, customerId, category: "", contractType: "MONTHLY", amount: "0", status: "ACTIVE", ...extra } as never);
  const pSns1 = await pr("SNS-001", "SNS運用代行（デモ）", sns, cMirai, { amount: "150000" });
  const pSns2 = await pr("AI-001", "AIチャットボット構築（デモ）", sns, cMirai, { contractType: "ONE_OFF", amount: "800000" });
  const pDa = await pr("DLV-A", "宅配ルート配送（デモ）", drv, cLogi, { rfQuantity: true, rfQuantityUnit: "個", rfBreakTime: true, rfAttachments: true });
  const pDb = await pr("DLV-B", "冷凍便チャーター（デモ）", drv, cLogi, { rfBreakTime: true, rfDistance: true });
  await pr("CLN-001", "オフィス定期清掃（デモ）", cln, cBuild, { amount: "120000" });

  // 売上・入金（前月は一部入金済み、1件は入金予定日を過ぎて未入金）
  const sale = (m: string, divisionId: string, projectId: string, description: string, amount: number, expected: string) => createSale(db, acct, { recognizedOn: monthRange(m)[1], divisionId, projectId, description, amountExTax: String(amount), taxRate: 10, billingStatus: "BILLED", expectedReceiptDate: expected });
  const s1 = await sale(prev, sns, pSns1, `SNS運用 ${prev}`, 150000, addDays(today, -8));
  await sale(prev, sns, pSns2, "チャットボット構築 着手金", 400000, addDays(today, -8));
  const s3 = await sale(prev, drv, pDa, `配送委託料 ${prev}`, 1000000, addDays(today, -5));
  await sale(cur, sns, pSns1, `SNS運用 ${cur}`, 150000, addDays(monthRange(cur)[1], 30));
  await sale(cur, drv, pDa, `配送委託料 ${cur}（見込み）`, 950000, addDays(monthRange(cur)[1], 25));
  await addReceipt(db, acct, { saleId: s1, receivedOn: addDays(today, -9), amount: "165000", idempotencyKey: `demo:${s1}` });
  await addReceipt(db, acct, { saleId: s3, receivedOn: addDays(today, -6), amount: "1100000", idempotencyKey: `demo:${s3}` });

  // 予算ルールと配賦
  const rule = (name: string, divisionId: string | undefined, categoryId: string, o: Record<string, unknown>) =>
    saveRule(db, owner, null, { name, divisionId, categoryId, period: "MONTH", fixedAmount: "0", perHeadAmount: "0", headcountBasis: "DIVISION_DRIVERS", base: "NONE", basePercent: 0, baseWindow: "PREV", carryOver: false, effectiveFrom: `${prev}-01`, overAction: "WARN", priority: 0, ...o } as never);
  await rule("SNS 広告宣伝費（月5万円）", sns, cats["広告宣伝費"], { fixedAmount: "50000" });
  await rule("委託 燃料費（1人あたり月1.5万円）", drv, cats["燃料費"], { perHeadAmount: "15000", overAction: "BLOCK" });
  await rule("SNS 外注費（前月売上の20%）", sns, cats["外注費"], { base: "SALES", basePercent: 20 });
  await saveAllocationRule(db, owner, { name: "共通経費（売上比で配賦）", method: "SALES_RATIO", effectiveFrom: prev, shares: {} });

  // 経費
  const exp = async (a: Actor, approver: Actor, o: { usedOn: string; divisionId: string | null; projectId?: string; cat: string; payee: string; purpose: string; amount: number; submit?: boolean; approve?: boolean }) => {
    const id = await createExpense(db, a, { usedOn: o.usedOn, divisionId: o.divisionId ?? "COMMON", projectId: o.projectId, categoryId: cats[o.cat], payee: o.payee, purpose: o.purpose, amount: String(o.amount), taxRate: 10, settlement: "SEPARATE" } as never);
    if (o.submit !== false) await submitExpense(db, a, id, { exceptionReason: "" });
    if (o.approve !== false && o.submit !== false) await approveExpense(db, approver, id);
    return id;
  };
  await exp(acct, owner, { usedOn: `${prev}-25`, divisionId: null, cat: "地代家賃", payee: "（デモ）不動産管理", purpose: `事務所家賃 ${prev}`, amount: 110000 });
  await exp(acct, owner, { usedOn: `${cur}-01`, divisionId: null, cat: "ソフトウェア・クラウド利用料", payee: "（デモ）クラウド", purpose: "業務システム利用料", amount: 22000 });
  await exp(mSns, owner, { usedOn: `${prev}-12`, divisionId: sns, projectId: pSns1, cat: "外注費", payee: "山田デザイン事務所（デモ）", purpose: "SNS用画像制作", amount: 55000 });
  await exp(mSns, owner, { usedOn: addDays(today, -3), divisionId: sns, projectId: pSns1, cat: "広告宣伝費", payee: "（デモ）SNS広告", purpose: "キャンペーン広告", amount: 44000 });
  await exp(mSns, owner, { usedOn: addDays(today, -1), divisionId: sns, cat: "消耗品費", payee: "（デモ）家電量販店", purpose: "撮影用ライト", amount: 8800, approve: false });

  // 契約テンプレート（デモ環境のみ承認）と契約
  const [tpl] = (await listTemplates(db)).filter((t) => t.key === "outsourcing");
  if (tpl && tpl.status === "UNREVIEWED") await approveTemplate(db, owner, tpl.id, "デモ: 動作確認のため承認（実際の利用前に専門家の確認が必要）");
  const [tplA] = (await listTemplates(db)).filter((t) => t.key === "outsourcing" && t.status === "APPROVED");
  if (tplA) {
    const c = await createContract(db, mSns, { title: "SNS画像制作 業務委託契約書（デモ）", ourSide: "ORDERER", partnerId: kYamada, divisionId: sns, templateId: tplA.id, terms: { ordererName: "株式会社エースナンバー東北（デモ）", contractorName: "山田デザイン事務所（デモ）", scope: "SNS投稿用の画像・動画素材の制作", periodStart: `${prev}-01`, periodEnd: addDays(today, 20), fee: "1点あたり 5,000円（税別）", feeMethod: "納品点数×単価", closingDay: "末日", paymentDay: "翌月末日", expenseBurden: "乙の負担とする", renewal: "期間満了の1か月前までに申し出がない場合、同条件で1年更新する。", termination: "1か月前の書面通知により解約できる。", confidentiality: "", deliverables: "制作物はデータで納品する。", special: "" } });
    await setContractStatus(db, owner, c, "REVIEWED");
    await setContractStatus(db, mSns, c, "SENT");
  }

  // ドライバー（デモ。LINEの代わりに模擬ID）
  const drivers: Actor[] = [];
  for (const [i, [name, quals, vehicles]] of ([["佐藤 一郎（デモ）", ["冷凍"], ["軽バン"]], ["鈴木 次郎（デモ）", [], ["軽バン"]], ["高橋 三郎（デモ）", ["冷凍"], ["2t"]]] as const).entries()) {
    const [u] = await db.insert(appUser).values({ name, email: `driver${i + 1}${D}`, role: "DRIVER", status: "ACTIVE", lineUserId: `Udemo${randomBytes(14).toString("hex")}`, emailVerifiedAt: new Date(), approvedAt: new Date(), approvedById: mDrv.userId }).returning();
    await db.insert(driver).values({ userId: u.id, divisionId: drv, qualifications: [...quals], vehicles: [...vehicles], taxMode: "EXCLUSIVE" });
    drivers.push({ userId: u.id, name, email: u.email, role: "DRIVER", divisionIds: [], demo: true });
  }
  await addRate(db, mDrv, { projectId: pDa, method: "PER_UNIT", unitPrice: "150", unitLabel: "個", effectiveFrom: `${prev}-01` });
  await addRate(db, mDrv, { projectId: pDb, method: "HOURLY", unitPrice: "1800", effectiveFrom: `${prev}-01` });

  // 前月・今月: 稼働希望 → 枠 → 自動割当 → 確定 → 日報 → 承認
  for (const m of [prev, cur]) {
    const [from, to] = monthRange(m);
    await db.delete(availabilityPeriod).where(eq(availabilityPeriod.month, m));
    await openPeriod(db, mDrv, { month: m, deadline: `${addDays(from, -5)}T18:00`, divisionId: drv });
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
    const weekdays = dates.filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
    for (const [i, a] of drivers.entries()) {
      await saveMyAvailability(db, a, m, dates.map((d, k) => ({ date: d, kind: weekdays.includes(d) ? ((k + i) % 7 === 0 ? "UNAVAILABLE" : "AVAILABLE") : "UNAVAILABLE" })));
      await submitMyAvailability(db, a, m);
    }
    await createSlots(db, mDrv, { projectId: pDa, dates: weekdays, startTime: "08:30", endTime: "17:30", requiredCount: 2 });
    await createSlots(db, mDrv, { projectId: pDb, dates: weekdays.filter((_, k) => k % 2 === 0), startTime: "18:00", endTime: "22:00", requiredCount: 1, requiredQualifications: "冷凍" });
    await autoAssign(db, mDrv, { month: m, divisionId: drv });
    await confirmAssignments(db, mDrv, { month: m, divisionId: drv });
    await closePeriod(db, mDrv, m);
    const asg = await db.execute<{ driver_id: string; work_date: string; start_time: string; end_time: string; project_id: string }>(sql`select a.driver_id, a.work_date::text, a.start_time::text, a.end_time::text, s.project_id from assignment a join shift_slot s on s.id = a.slot_id where a.status = 'CONFIRMED' and a.work_date between ${from} and ${to} and a.work_date <= ${addDays(today, -2)} order by a.work_date`);
    for (const r of asg.rows) {
      const a = drivers.find((d) => d.userId === r.driver_id)!;
      const isA = r.project_id === pDa;
      const id = await saveMyReport(db, a, null, { workDate: r.work_date, projectId: r.project_id, startTime: r.start_time.slice(0, 5), endTime: r.end_time.slice(0, 5), breakMinutes: isA ? "60" : "0", quantity: isA ? String(80 + ((r.work_date.charCodeAt(9) * 7) % 40)) : "", distanceKm: isA ? "" : "62", notes: "（デモ）配送完了" }, true);
      if (m === prev || r.work_date < addDays(today, -5)) await approveReport(db, mDrv, id);
    }
  }
  // 前月の稼働明細: 作成 → 確定 → 公開
  await generateForDivision(db, acct, { month: prev, divisionId: drv });
  for (const { s: st } of await listStatements(db, acct, { month: prev })) {
    await setStatementStatus(db, acct, st.id, "CONFIRMED");
    await setStatementStatus(db, acct, st.id, "PUBLISHED");
  }
  // 翌月の稼働希望の受付（1人だけ未提出 → リマインドの対象）
  await openPeriod(db, mDrv, { month: next, deadline: `${addDays(today, 5)}T18:00`, divisionId: drv });
  const [nf, nt] = monthRange(next);
  for (const a of drivers.slice(0, 2)) {
    const days: { date: string; kind: "AVAILABLE" | "UNAVAILABLE" }[] = [];
    for (let d = nf; d <= nt; d = addDays(d, 1)) days.push({ date: d, kind: [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? "UNAVAILABLE" : "AVAILABLE" });
    await saveMyAvailability(db, a, next, days);
    await submitMyAvailability(db, a, next);
  }

  // デモ銀行口座
  const bank = await createBankAccount(db, owner, { bankName: "デモ銀行", branchName: "仙台支店", accountNumberLast4: "0000", provider: "DEMO", openingBalance: "3200000" });
  await syncBankAccount(db, owner, bank);

  await db.update(companySetting).set({ demoDataLoadedAt: new Date() });
  await refreshActionCards(db);
  void mCln; // 清掃事業部の責任者（デモログイン用）
  console.log("デモデータを投入しました（すべて架空のデータです）");
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });
