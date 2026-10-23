/**
 * 入出金の公開範囲（サービス提供者・本社・スタッフ）
 * 完了条件:
 *  1 表示範囲が分かれる / 2 取引単位で公開先を変更 / 3 新規取込は下書き / 4 本社・スタッフ公開は独立
 *  5 非公開取引が検索・集計・通知・出力に漏れない / 6 非公開と集計対象外は別 / 7 原本と操作履歴が残る
 *  8 本社・スタッフは権限を上げられない / 9 他社・他スタッフのデータを直接取得できない / 10 公開停止後は拒否
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { actionCard, appUser, auditLog, bankTransaction, providerAssignment, SELF_COMPANY_ID } from "@/db/schema";
import type { Actor } from "@/lib/access";
import { refreshActionCards } from "@/server/actions-engine";
import { createBankAccount, importBankCsv } from "@/server/bank";
import { buildDigest, digestToSlack } from "@/server/digest";
import { exportVisibleCsv, getVisibleTxn, hiddenSummary, listVisibleTxns, previewViewer, summarize, viewerFor } from "@/server/finance-visibility";
import { listAuditLogs, updateStaff } from "@/server/masters";
import { getCashPosition } from "@/server/metrics";
import { addCorrection, addManualTxn, companyAudit, previewVisibility, providerListTxns, savePolicy, setExcluded, setVisibility, updateTxnMeta } from "@/server/provider-finance";
import { makeCompany, makeDivision, makeProvider, makeUser, resetDb } from "./helpers/db";

let owner: Actor, acct: Actor, mgr: Actor, d1: Actor, d2: Actor, d3: Actor, prov: Actor, prov2: Actor;
let dDrv = "", dCln = "", other = "", acc = "", acc2 = "";
const ids: Record<string, string> = {};
const CSV = (rows: string[]) => ["日付,内容,入金,出金,残高", ...rows].join("\r\n");

beforeAll(async () => {
  await resetDb();
  const db = getDb();
  dDrv = await makeDivision("DRV", "業務委託事業部", "DRIVER");
  dCln = await makeDivision("CLN", "清掃事業部", "CLEANING");
  owner = await makeUser("代表", "OWNER");
  acct = await makeUser("経理", "ACCOUNTING");
  mgr = await makeUser("責任者", "MANAGER", { divisionIds: [dDrv] });
  d1 = await makeUser("ドライバー1", "DRIVER", { driverDivisionId: dDrv });
  d2 = await makeUser("ドライバー2", "DRIVER", { driverDivisionId: dDrv });
  d3 = await makeUser("清掃スタッフ", "DRIVER", { driverDivisionId: dCln });
  other = await makeCompany("他社");
  prov = await makeProvider("提供者", [SELF_COMPANY_ID]);
  prov2 = await makeProvider("他社の提供者", [other]);
  acc = await createBankAccount(db, prov, SELF_COMPANY_ID, { bankName: "七十七銀行", branchName: "本店", accountNumberLast4: "1234" });
  await importBankCsv(db, prov, acc, "a.csv", CSV([
    "2026/10/01,売上入金 ミライ,500000,,1500000",
    "2026/10/02,役員報酬,,800000,700000",
    "2026/10/03,燃料代 精算,,12000,688000",
    "2026/10/04,清掃資材,,30000,658000",
    "2026/10/05,重複取込,,30000,628000",
  ]));
  const rows = await db.select().from(bankTransaction).where(eq(bankTransaction.accountId, acc));
  for (const r of rows) ids[r.description] = r.id;
  acc2 = await createBankAccount(db, prov2, other, { bankName: "他社銀行", branchName: "本店", accountNumberLast4: "9999" });
  await importBankCsv(db, prov2, acc2, "o.csv", CSV(["2026/10/01,他社の入金,999999,,999999"]));
});
afterAll(closeDb);

const hq = () => viewerFor(getDb(), owner);
const st = (a: Actor) => viewerFor(getDb(), a);

describe("3. 新規取込は下書き（提供者だけが見える）", () => {
  it("取込直後は本社・スタッフには何も見えない", async () => {
    const db = getDb();
    const all = await db.select().from(bankTransaction).where(eq(bankTransaction.accountId, acc));
    expect(all.every((t) => t.publishStatus === "DRAFT" && !t.hqVisible && !t.staffVisible)).toBe(true);
    expect(await listVisibleTxns(db, await hq())).toHaveLength(0);
    expect(await listVisibleTxns(db, await st(d1)).catch(() => [])).toHaveLength(0);
    expect(await providerListTxns(db, prov, SELF_COMPANY_ID)).toHaveLength(5);
  });
  it("手動登録も下書き", async () => {
    const db = getDb();
    const id = await addManualTxn(db, prov, acc, { txnDate: "2026-10-06", direction: "out", amount: "5000", description: "現金払いの記録", reason: "通帳に載らない支払" });
    const [t] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, id));
    expect([t.publishStatus, t.source, t.hqVisible]).toEqual(["DRAFT", "MANUAL", false]);
    ids["現金払いの記録"] = id;
  });
});

describe("1・2・4. 表示範囲は3者で分かれ、本社公開とスタッフ公開は独立", () => {
  it("本社に公開した取引はスタッフには見えない", async () => {
    const db = getDb();
    await setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["売上入金 ミライ"], ids["清掃資材"], ids["重複取込"]] }, { status: "PUBLISHED", hq: true });
    expect((await listVisibleTxns(db, await hq())).map((t) => t.description).sort()).toEqual(["売上入金 ミライ", "清掃資材", "重複取込"].sort());
    expect(await listVisibleTxns(db, await st(d1)).catch(() => [])).toHaveLength(0);
  });
  it("スタッフは提供者が明細の閲覧を許可するまで、事業部あてに公開されても見えない（招待した本社・責任者が閲覧範囲を広げられない）", async () => {
    const db = getDb();
    await setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["燃料代 精算"]] }, { status: "PUBLISHED", staff: true, audience: { users: [], divisions: [dDrv] } });
    expect(await listVisibleTxns(db, await st(d1)).catch(() => [])).toHaveLength(0);
    await expect(listVisibleTxns(db, await st(d1))).rejects.toThrow(/公開されていません/);
    expect((await summarize(db, await st(d1))).published).toBeNull();
    for (const d of [d1, d2, d3]) await savePolicy(db, prov, SELF_COMPANY_ID, `STAFF:${d.userId}`, { viewDetails: true, viewPublishedTotals: false, viewAllTotals: false, viewRealBalance: false, canExport: false });
    expect((await listVisibleTxns(db, await st(d2))).map((t) => t.description)).toEqual(["燃料代 精算"]);
  });
  it("スタッフ公開は指定スタッフ・事業部だけ。本社には見えない", async () => {
    const db = getDb();
    await setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["燃料代 精算"]] }, { status: "PUBLISHED", staff: true, audience: { users: [d1.userId], divisions: [] } });
    await setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["清掃資材"]] }, { staff: true, audience: { users: [], divisions: [dCln] } });
    expect((await listVisibleTxns(db, await st(d1))).map((t) => t.description)).toEqual(["燃料代 精算"]);
    expect(await listVisibleTxns(db, await st(d2))).toHaveLength(0); // 同じ事業部でも本人指定のものは見えない
    expect((await listVisibleTxns(db, await st(d3))).map((t) => t.description)).toEqual(["清掃資材"]);
    expect((await listVisibleTxns(db, await hq())).map((t) => t.description)).not.toContain("燃料代 精算");
  });
  it("スタッフ公開には公開対象が必要／公開状態が「公開中」でなければ誰にも見えない", async () => {
    const db = getDb();
    await expect(setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["役員報酬"]] }, { status: "PUBLISHED", staff: true })).rejects.toThrow(/公開対象/);
    await setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["役員報酬"]] }, { hq: true }); // 下書きのまま本社公開フラグだけ
    expect((await listVisibleTxns(db, await hq())).map((t) => t.description)).not.toContain("役員報酬");
  });
  it("事業部責任者は入出金を見られない", async () => {
    await expect(viewerFor(getDb(), mgr)).rejects.toThrow(/権限/);
  });
});

describe("一括変更は確認してから・件数が変わっていたら実行しない", () => {
  it("確認で対象件数と公開先が分かる。件数が違えば拒否", async () => {
    const db = getDb();
    const sel = { filter: { from: "2026-10-01", to: "2026-10-31", status: "DRAFT" } };
    const p = await previewVisibility(db, prov, SELF_COMPANY_ID, sel, { status: "PUBLISHED", hq: true });
    expect(p.count).toBe(2); // 役員報酬・現金払いの記録
    expect(p.afterHq).toBe(2);
    await expect(setVisibility(db, prov, SELF_COMPANY_ID, { ids: p.ids }, { status: "DRAFT" }, p.count + 1)).rejects.toThrow(/件数/);
  });
  it("他社の取引IDが混ざっていたら拒否", async () => {
    const db = getDb();
    const [o] = await db.select().from(bankTransaction).where(eq(bankTransaction.accountId, acc2));
    await expect(setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["役員報酬"], o.id] }, { status: "PUBLISHED" })).rejects.toThrow(/見つかりません/);
  });
});

describe("5. 非公開の取引は検索・集計・出力・通知に出ない", () => {
  it("検索しても非公開の取引は出ない", async () => {
    const db = getDb();
    expect(await listVisibleTxns(db, await hq(), { q: "役員" })).toHaveLength(0);
    expect(await listVisibleTxns(db, await hq(), { q: "ミライ" })).toHaveLength(1);
  });
  it("本社の初期表示は公開分だけの集計。残高・全体集計は計算もしない", async () => {
    const db = getDb();
    const s = await summarize(db, await hq());
    expect(s.balances).toBeNull();
    expect(s.all).toBeNull();
    expect(s.published!.income).toBe(500000);
    expect(s.published!.expense).toBe(60000); // 清掃資材 + 重複取込（役員報酬・燃料代は含まない）
    const cash = await getCashPosition(db, acct);
    expect(cash.bankTotal).toBeNull();
    expect(cash.cashCapacity).toBeNull();
  });
  it("CSV出力は許可が必要で、出力しても見える明細だけ", async () => {
    const db = getDb();
    await expect(exportVisibleCsv(db, owner, await hq())).rejects.toThrow(/許可/);
    await savePolicy(db, prov, SELF_COMPANY_ID, "HQ", { viewDetails: true, viewPublishedTotals: true, viewAllTotals: false, viewRealBalance: false, canExport: true });
    const csv = await exportVisibleCsv(db, owner, await hq());
    expect(csv).toContain("売上入金 ミライ");
    expect(csv).not.toContain("役員報酬");
    expect(csv).not.toContain("燃料代");
  });
  it("AIの対応カード・Slackの要約・本社の監査ログに非公開取引の内容が出ない", async () => {
    const db = getDb();
    await refreshActionCards(db);
    const cards = await db.select().from(actionCard);
    expect(JSON.stringify(cards)).not.toContain("役員報酬");
    expect(cards.some((c) => c.ruleKey.startsWith("cash.") || c.ruleKey.startsWith("bank."))).toBe(false); // 実残高の許可がないため資金カードも作らない
    // 以前に作られた資金カード（残高入り）も、許可がなければ一覧・件数・要約に出さない
    await db.insert(actionCard).values({ ruleKey: "cash.capacity", targetKey: "old", priority: 1, title: "資金余力が低下（旧）", finding: "残高 1,234,567円", evidence: [], periodLabel: "x", recommendation: "x", assigneeRole: "ACCOUNTING", status: "DONE", link: "/app" } as never);
    const { listActionCards } = await import("@/server/actions-engine");
    expect((await listActionCards(db, owner, { status: "all" })).some((c) => c.c.ruleKey.startsWith("cash."))).toBe(false);
    const slack = JSON.stringify(digestToSlack(await buildDigest(db), false));
    expect(slack).not.toContain("役員報酬");
    const logs = await listAuditLogs(db, owner, {});
    expect(JSON.stringify(logs.rows)).not.toMatch(/役員報酬|800000|bank\./);
    expect(logs.rows.some((r) => ["bank_transaction", "bank_account", "disclosure_policy", "finance_export"].includes(r.entityType))).toBe(false);
  });
});

describe("6. 非公開と集計対象外は別", () => {
  it("集計対象外にしても一覧には残り（表示あり）、合計からは外れる。非公開の取引は全体集計には含まれる", async () => {
    const db = getDb();
    await expect(setExcluded(db, prov, ids["重複取込"], true, "")).rejects.toThrow(/理由/);
    await setExcluded(db, prov, ids["重複取込"], true, "CSVの二重取込");
    const list = await listVisibleTxns(db, await hq());
    expect(list.find((t) => t.description === "重複取込")?.excluded).toBe(true);
    expect((await summarize(db, await hq())).published!.expense).toBe(30000);
    const p = await summarize(db, { kind: "PROVIDER", companyId: SELF_COMPANY_ID, userId: prov.userId });
    expect(p.all!.expense).toBe(800000 + 12000 + 30000 + 5000); // 非公開も含む・集計対象外は除く
    const [t] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, ids["重複取込"]));
    expect(t.amount).toBe(-30000); // 原本は消えない
  });
});

describe("7. 銀行の原本と操作履歴が残る", () => {
  it("原本の金額・日付は変更も削除もできない（DBで拒否）", async () => {
    const db = getDb();
    await expect(db.update(bankTransaction).set({ amount: 1 }).where(eq(bankTransaction.id, ids["役員報酬"]))).rejects.toThrow();
    await expect(db.update(bankTransaction).set({ txnDate: "2026-01-01" }).where(eq(bankTransaction.id, ids["役員報酬"]))).rejects.toThrow();
    await expect(db.delete(bankTransaction).where(eq(bankTransaction.id, ids["役員報酬"]))).rejects.toThrow();
  });
  it("訂正は追記され、表示・集計は訂正後。原本はそのまま。変更前後が履歴に残る", async () => {
    const db = getDb();
    await expect(addCorrection(db, prov, ids["売上入金 ミライ"], { txnDate: "2026-10-01", direction: "in", amount: "550000", description: "売上入金 ミライ商事", reason: "" })).rejects.toThrow(/理由/);
    await addCorrection(db, prov, ids["売上入金 ミライ"], { txnDate: "2026-10-01", direction: "in", amount: "550000", description: "売上入金 ミライ商事", reason: "銀行の表記ゆれと金額の誤り" });
    const v = await getVisibleTxn(db, await hq(), ids["売上入金 ミライ"]);
    expect([v.amount, v.description, v.corrected]).toEqual([550000, "売上入金 ミライ商事", true]);
    const [t] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, ids["売上入金 ミライ"]));
    expect(t.amount).toBe(500000);
    await expect(db.execute(sql`update bank_txn_correction set amount = 1`)).rejects.toThrow();
    const logs = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "bank_transaction"), eq(auditLog.entityId, ids["売上入金 ミライ"])));
    const vis = logs.find((l) => l.action === "bank.visibility")!;
    expect(vis.actorName).toBe("提供者");
    expect(vis.changes).toMatchObject({ before: { status: "DRAFT", hq: false }, after: { status: "PUBLISHED", hq: true } });
    expect(logs.find((l) => l.action === "bank.correction")!.changes).toMatchObject({ before: { amount: 500000 }, after: { amount: 550000 } });
    const a = await companyAudit(db, prov, SELF_COMPANY_ID);
    expect(a.total).toBeGreaterThan(5);
  });
  it("分類・メモの編集も履歴に残り、メモは本社に見えない", async () => {
    const db = getDb();
    await updateTxnMeta(db, prov, ids["清掃資材"], { classification: "EXPENSE_PAYMENT", note: "社内メモ: 領収書待ち", confirmStatus: "NEEDS_REVIEW", projectId: "" });
    const v = await getVisibleTxn(db, await hq(), ids["清掃資材"]);
    expect(v.classification).toBe("EXPENSE_PAYMENT");
    expect(JSON.stringify(v)).not.toContain("領収書待ち");
  });
});

describe("8. 本社・スタッフは自分の権限を上げられない", () => {
  it("公開設定・公開権限・取引の操作はサービス提供者だけ", async () => {
    const db = getDb();
    for (const a of [owner, acct, d1]) {
      await expect(setVisibility(db, a, SELF_COMPANY_ID, { ids: [ids["役員報酬"]] }, { status: "PUBLISHED", hq: true })).rejects.toThrow(/サービス提供者/);
      await expect(savePolicy(db, a, SELF_COMPANY_ID, "HQ", { viewDetails: true, viewPublishedTotals: true, viewAllTotals: true, viewRealBalance: true, canExport: true })).rejects.toThrow(/サービス提供者/);
      await expect(setExcluded(db, a, ids["役員報酬"], true, "x")).rejects.toThrow(/サービス提供者/);
      await expect(addCorrection(db, a, ids["役員報酬"], { txnDate: "2026-10-02", direction: "out", amount: "1", description: "x", reason: "x" })).rejects.toThrow(/サービス提供者/);
    }
  });
  it("経営者は提供者アカウントを変更できず、自分を提供者にもできない", async () => {
    const db = getDb();
    await expect(updateStaff(db, owner, prov.userId, { role: "OWNER", divisionIds: [], status: "ACTIVE" })).rejects.toThrow(/見つかりません/);
    await expect(updateStaff(db, owner, owner.userId, { role: "PROVIDER", divisionIds: [], status: "ACTIVE" })).rejects.toThrow();
  });
  it("本社の閲覧者が他社を指定しても拒否", async () => {
    await expect(viewerFor(getDb(), owner, other)).rejects.toThrow(/見つかりません/);
  });
});

describe("9. 他社・他スタッフのデータは直接取得できない", () => {
  it("提供者でも担当外の会社は扱えない", async () => {
    const db = getDb();
    const [o] = await db.select().from(bankTransaction).where(eq(bankTransaction.accountId, acc2));
    await expect(providerListTxns(db, prov, other)).rejects.toThrow(/見つかりません/);
    await expect(setVisibility(db, prov, other, { ids: [o.id] }, { status: "PUBLISHED", hq: true })).rejects.toThrow(/見つかりません/);
    await expect(setExcluded(db, prov, o.id, true, "x")).rejects.toThrow(/見つかりません/);
    await expect(importBankCsv(db, prov, acc2, "x.csv", CSV(["2026/10/09,x,1,,1"]))).rejects.toThrow(/見つかりません/);
    await expect(previewViewer(db, prov, other, "HQ")).rejects.toThrow(/見つかりません/);
    await expect(providerListTxns(db, prov2, SELF_COMPANY_ID)).rejects.toThrow(/見つかりません/);
  });
  it("本社・スタッフは他社の取引・他スタッフあての取引をIDで取得できない", async () => {
    const db = getDb();
    const [o] = await db.select().from(bankTransaction).where(eq(bankTransaction.accountId, acc2));
    await setVisibility(db, prov2, other, { ids: [o.id] }, { status: "PUBLISHED", hq: true });
    await expect(getVisibleTxn(db, await hq(), o.id)).rejects.toThrow(/見つかりません/);
    expect((await listVisibleTxns(db, await hq())).some((t) => t.id === o.id)).toBe(false);
    await expect(getVisibleTxn(db, await st(d2), ids["燃料代 精算"])).rejects.toThrow(/見つかりません/);
    await expect(getVisibleTxn(db, await st(d1), ids["燃料代 精算"])).resolves.toBeTruthy();
  });
  it("担当を外された提供者は、その場でアクセスできなくなる", async () => {
    const db = getDb();
    const tmp = await makeProvider("一時担当", [SELF_COMPANY_ID]);
    expect(await providerListTxns(db, tmp, SELF_COMPANY_ID)).not.toHaveLength(0);
    await db.delete(providerAssignment).where(eq(providerAssignment.userId, tmp.userId));
    await expect(providerListTxns(db, tmp, SELF_COMPANY_ID)).rejects.toThrow(/見つかりません/);
  });
});

describe("10. 公開停止後のアクセスは拒否", () => {
  it("公開停止にすると詳細・一覧・集計・出力から消える", async () => {
    const db = getDb();
    await expect(getVisibleTxn(db, await hq(), ids["清掃資材"])).resolves.toBeTruthy();
    await setVisibility(db, prov, SELF_COMPANY_ID, { ids: [ids["清掃資材"]] }, { status: "SUSPENDED" });
    await expect(getVisibleTxn(db, await hq(), ids["清掃資材"])).rejects.toThrow(/見つかりません/);
    await expect(getVisibleTxn(db, await st(d3), ids["清掃資材"])).rejects.toThrow(/見つかりません/);
    expect(await exportVisibleCsv(db, owner, await hq())).not.toContain("清掃資材");
    expect((await summarize(db, await hq())).published!.expense).toBe(0);
  });
});

describe("プレビューは実際の閲覧と同じ判定", () => {
  it("本社・スタッフとして見た結果が実際の閲覧と一致し、見えないものを示す", async () => {
    const db = getDb();
    for (const [as, real] of [["HQ", await hq()], [d1.userId, await st(d1)], [d3.userId, await st(d3)]] as const) {
      const v = await previewViewer(db, prov, SELF_COMPANY_ID, as);
      expect(await listVisibleTxns(db, v)).toEqual(await listVisibleTxns(db, real));
      expect(await summarize(db, v)).toEqual(await summarize(db, real));
    }
    const h = await hiddenSummary(db, prov, await previewViewer(db, prov, SELF_COMPANY_ID, "HQ"));
    expect(h.notShown.join()).toContain("実際の銀行残高");
    await expect(previewViewer(db, prov, SELF_COMPANY_ID, owner.userId)).rejects.toThrow(/スタッフ/); // スタッフ以外は指定できない
  });
  it("実残高・全体集計を許可すると、そのときだけ値が返る", async () => {
    const db = getDb();
    await savePolicy(db, prov, SELF_COMPANY_ID, `STAFF:${d1.userId}`, { viewDetails: true, viewPublishedTotals: true, viewAllTotals: false, viewRealBalance: true, canExport: false });
    const s = await summarize(db, await st(d1));
    expect(s.balances).not.toBeNull();
    expect(s.all).toBeNull();
    expect((await summarize(db, await st(d2))).balances).toBeNull(); // 他のスタッフには影響しない
    await expect(savePolicy(db, prov, SELF_COMPANY_ID, `STAFF:${owner.userId}`, { viewDetails: true, viewPublishedTotals: true, viewAllTotals: true, viewRealBalance: true, canExport: true })).rejects.toThrow(/見つかりません/);
    const [u] = await db.select().from(appUser).where(eq(appUser.id, d1.userId));
    expect(u.role).toBe("DRIVER");
  });
});
