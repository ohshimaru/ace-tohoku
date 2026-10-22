import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { bankTransaction, monthClose, partner, payable, receipt, sale } from "@/db/schema";
import type { Actor } from "@/lib/access";
import { addOtherPayable, createSale } from "@/server/sales";
import { createBankAccount, getTransaction, importBankCsv, matchCandidates, matchPayable, receiveFromTxn, syncBankAccount, unmatch } from "@/server/bank";
import { importCleanupInvoices } from "@/server/cleanup";
import { addSignedFile, approveTemplate, createContract, createTemplateVersion, getContract, listContracts, setContractStatus, updateContract } from "@/server/contracts";
import { closePeriod, openPeriod } from "@/server/shifts";
import { retryEmail, saveReminderRules } from "@/server/mailer";
import { csvCell } from "@/server/csv";
import { emailOutbox } from "@/db/schema";
import { makeDivision, makeUser, resetDb } from "./helpers/db";

let owner: Actor, acct: Actor, mgr: Actor, mgr2: Actor, otherMgr: Actor, drv: Actor;
let dSns = "", dCln = "", dDrv = "", customer = "", contractor = "";

beforeAll(async () => {
  await resetDb();
  dSns = await makeDivision("SNS", "SNS・AI開発事業部");
  dCln = await makeDivision("CLN", "清掃事業部", "CLEANING");
  dDrv = await makeDivision("DRV", "業務委託事業部", "DRIVER");
  owner = await makeUser("代表", "OWNER");
  acct = await makeUser("経理", "ACCOUNTING");
  mgr = await makeUser("SNS責任者", "MANAGER", { divisionIds: [dSns] });
  mgr2 = await makeUser("SNS副責任者", "MANAGER", { divisionIds: [dSns] });
  otherMgr = await makeUser("清掃責任者", "MANAGER", { divisionIds: [dCln] });
  drv = await makeUser("ドライバー", "DRIVER", { driverDivisionId: dDrv });
  const db = getDb();
  [{ id: customer }] = await db.insert(partner).values({ name: "株式会社みらい商事", isCustomer: true }).returning({ id: partner.id });
  [{ id: contractor }] = await db.insert(partner).values({ name: "山田デザイン", isContractor: true, isCustomer: true }).returning({ id: partner.id });
});
afterAll(closeDb);

const CSV = (rows: string[]) => ["日付,内容,入金,出金,残高", ...rows].join("\r\n");

describe("銀行: 取込・同期は重複しない", () => {
  let acc = "";
  it("責任者は銀行を扱えない／口座番号は下4桁のみ", async () => {
    const db = getDb();
    await expect(createBankAccount(db, mgr, { bankName: "七十七銀行", branchName: "本店", accountNumberLast4: "1234" })).rejects.toThrow(/経営者・経理/);
    await expect(createBankAccount(db, acct, { bankName: "七十七銀行", branchName: "本店", accountNumberLast4: "1234567" })).rejects.toThrow(/下4桁/);
    acc = await createBankAccount(db, acct, { bankName: "七十七銀行", branchName: "本店", accountNumberLast4: "1234", openingBalance: "1000000" });
  });

  it("同じCSVを2回取り込んでも1回分。同じ内容の行が2つあれば2件", async () => {
    const db = getDb();
    const text = CSV(["2026/09/30,振込 ミライシヨウジ,110000,,1110000", "2026/10/01,手数料,,440,1109560", "2026/10/01,手数料,,440,1109560", "2026/10/02,=cmd|' /C calc'!A0,,33000,1076560"]);
    const a = await importBankCsv(db, acct, acc, "a.csv", text);
    const b = await importBankCsv(db, acct, acc, "a.csv", text);
    expect(a).toEqual({ imported: 4, skipped: 0 });
    expect(b).toEqual({ imported: 0, skipped: 4 });
    const rows = await db.select().from(bankTransaction).where(eq(bankTransaction.accountId, acc));
    expect(rows).toHaveLength(4);
    // 取込データはそのまま保存し、CSV・Excel出力時に数式として扱われないようにする（画面表示はエスケープ）
    const { csvCell } = await import("@/server/csv");
    expect(csvCell(rows.find((r) => r.amount === -33000)!.description).startsWith("'=")).toBe(true);
    await expect(importBankCsv(db, acct, acc, "b.csv", CSV(["2026/10/03,両方,100,100,0"]))).rejects.toThrow(/どちらか一方/);
  });

  it("デモ口座の同期は何度実行しても重複しない／CSV口座は自動同期しない", async () => {
    const db = getDb();
    const demo = await createBankAccount(db, owner, { bankName: "デモ銀行", branchName: "デモ支店", accountNumberLast4: "0000", provider: "DEMO" });
    const r1 = await syncBankAccount(db, owner, demo);
    const r2 = await syncBankAccount(db, owner, demo);
    expect(r1.imported).toBeGreaterThan(0);
    expect(r2.imported).toBe(0);
    await expect(syncBankAccount(db, owner, acc)).rejects.toThrow(/CSV/);
  });

  it("出金を支払予定に照合 → 支払済み。二重照合は不可。解除で未払いに戻る", async () => {
    const db = getDb();
    await addOtherPayable(db, acct, { payeeName: "デザイン外注", description: "9月分", amount: "33000", dueDate: "2026-10-02" });
    const [p] = await db.select().from(payable).where(eq(payable.payeeName, "デザイン外注"));
    const [t] = await db.select().from(bankTransaction).where(eq(bankTransaction.amount, -33000));
    const c = await matchCandidates(db, acct, t.id);
    expect(c.payables[0].id).toBe(p.id);
    await matchPayable(db, acct, t.id, p.id);
    const [paid] = await db.select().from(payable).where(eq(payable.id, p.id));
    expect(paid.status).toBe("PAID");
    expect(paid.paidOn).toBe("2026-10-02");
    await expect(matchPayable(db, acct, t.id, p.id)).rejects.toThrow();
    const x = await getTransaction(db, acct, t.id);
    expect(x.remaining).toBe(0);
    await unmatch(db, acct, x.matches[0].id, "誤り");
    const [back] = await db.select().from(payable).where(eq(payable.id, p.id));
    expect(back.status).toBe("SCHEDULED");
    expect(back.bankTransactionId).toBeNull();
  });

  it("入金から売上の入金を登録（同時・繰り返しでも1件）。解除すると入金記録も取消", async () => {
    const db = getDb();
    const saleId = await createSale(db, acct, { recognizedOn: "2026-09-30", divisionId: dSns, customerId: customer, description: "SNS運用 9月", amountExTax: "100000", taxRate: 10 });
    const [t] = await db.select().from(bankTransaction).where(eq(bankTransaction.amount, 110000));
    const [a, b] = await Promise.all([receiveFromTxn(db, acct, t.id, saleId), receiveFromTxn(db, acct, t.id, saleId)]);
    expect(a.id).toBe(b.id);
    const rs = await db.select().from(receipt).where(eq(receipt.saleId, saleId));
    expect(rs).toHaveLength(1);
    const x = await getTransaction(db, acct, t.id);
    expect(x.matches.filter((m) => !m.unmatched_at)).toHaveLength(1);
    expect(x.remaining).toBe(0);
    await unmatch(db, acct, x.matches[0].id, "別の売上だった");
    const [r] = await db.select().from(receipt).where(eq(receipt.saleId, saleId));
    expect(r.canceledAt).not.toBeNull();
  });
});

describe("契約書", () => {
  let tpl = "", cid = "";
  const terms = { ordererName: "株式会社エースナンバー東北", contractorName: "山田デザイン", scope: "SNS用画像の制作", periodStart: "2026-10-01", periodEnd: "2027-03-31", fee: "月額 100,000円（税別）", feeMethod: "固定", closingDay: "末日", paymentDay: "翌月末", expenseBurden: "受注者負担", renewal: "", termination: "", confidentiality: "", deliverables: "", special: "" };
  it("未承認のテンプレートは使えない。承認は経営者のみ", async () => {
    const db = getDb();
    tpl = await createTemplateVersion(db, mgr, { key: "outsourcing", name: "業務委託契約書", body: "{{title}}\n{{ordererName}}（甲）と{{contractorName}}（乙）は…\n業務: {{scope}}\n期間: {{periodStart}}〜{{periodEnd}}\n報酬: {{fee}}\n支払: {{paymentDay}}" });
    await expect(createTemplateVersion(db, mgr, { key: "x-1", name: "x", body: "{{unknownField}} ああああああああああああああああ" })).rejects.toThrow(/使えない/);
    await expect(createContract(db, mgr, { title: "制作委託", ourSide: "ORDERER", partnerId: contractor, divisionId: dSns, templateId: tpl, terms })).rejects.toThrow(/承認済み/);
    await expect(approveTemplate(db, mgr, tpl, "確認")).rejects.toThrow(/経営者/);
    await approveTemplate(db, owner, tpl, "2026-10-01 社労士確認");
  });

  it("差し込み→社内確認（作成者以外）→送付→締結（ファイル必須）→改訂で履歴", async () => {
    const db = getDb();
    await expect(createContract(db, otherMgr, { title: "制作委託", ourSide: "ORDERER", partnerId: contractor, divisionId: dSns, templateId: tpl, terms })).rejects.toThrow(/権限/);
    cid = await createContract(db, mgr, { title: "制作委託", ourSide: "ORDERER", partnerId: contractor, divisionId: dSns, templateId: tpl, terms: { ...terms, fee: "" } });
    const c0 = await getContract(db, mgr, cid);
    expect(c0.c.renderedBody).toContain("【未入力: 報酬】");
    await expect(setContractStatus(db, mgr2, cid, "REVIEWED")).rejects.toThrow(/未入力/);
    await updateContract(db, mgr, cid, { title: "制作委託", ourSide: "ORDERER", partnerId: contractor, divisionId: dSns, templateId: tpl, terms }, "");
    await expect(setContractStatus(db, mgr, cid, "REVIEWED")).rejects.toThrow(/作成者以外/);
    await setContractStatus(db, mgr2, cid, "REVIEWED");
    await setContractStatus(db, mgr, cid, "SENT");
    await expect(setContractStatus(db, mgr, cid, "SIGNED")).rejects.toThrow(/ファイル/);
    await addSignedFile(db, mgr, cid, { name: "signed.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%test\n") });
    await setContractStatus(db, mgr, cid, "SIGNED");
    await expect(updateContract(db, mgr, cid, { title: "制作委託", ourSide: "ORDERER", partnerId: contractor, divisionId: dSns, templateId: tpl, terms: { ...terms, fee: "月額 120,000円" } }, "")).rejects.toThrow(/改訂の理由/);
    await updateContract(db, mgr, cid, { title: "制作委託", ourSide: "ORDERER", partnerId: contractor, divisionId: dSns, templateId: tpl, terms: { ...terms, fee: "月額 120,000円" } }, "単価改定");
    const c = await getContract(db, mgr, cid);
    expect(c.c.status).toBe("DRAFT");
    expect(c.c.revision).toBe(3);
    expect(c.revisions[0].terms.fee).toBe("月額 100,000円（税別）");
    expect(c.files).toHaveLength(1);
    // 他事業部・ドライバーからは見えない
    await expect(getContract(db, otherMgr, cid)).rejects.toThrow(/見つかりません/);
    expect(await listContracts(db, drv)).toHaveLength(0);
  });
});

describe("Clean Up 請求書CSVの取込（読み取りのみ・外部IDで重複なし）", () => {
  const H = "請求書番号,取引先コード,取引先,発行日,期間開始,期間終了,支払期限,小計,消費税,合計,入金済,状態";
  it("取込・再取込・変更・無効を正しく反映", async () => {
    const db = getDb();
    const v1 = [H, "INV-202609-001,C001,株式会社みらい商事,2026-09-30,2026-09-01,2026-09-30,2026-10-31,50000,5000,55000,0,issued", "INV-202609-002,C002,新規ビル管理,2026-09-30,2026-09-01,2026-09-30,2026-10-31,30000,3000,33000,0,sent", "INV-202609-003,C001,株式会社みらい商事,2026-09-30,2026-09-01,2026-09-30,2026-10-31,1000,100,1100,0,void"].join("\r\n");
    await expect(importCleanupInvoices(db, mgr, { divisionId: dCln, fileName: "x.csv", text: v1, createCustomers: false })).rejects.toThrow(/担当外/);
    await expect(importCleanupInvoices(db, owner, { divisionId: dSns, fileName: "x.csv", text: v1, createCustomers: false })).rejects.toThrow(/清掃/);
    const r1 = await importCleanupInvoices(db, otherMgr, { divisionId: dCln, fileName: "x.csv", text: v1, createCustomers: false });
    expect(r1).toMatchObject({ created: 2, skipped: 1, errors: [] });
    const r2 = await importCleanupInvoices(db, otherMgr, { divisionId: dCln, fileName: "x.csv", text: v1, createCustomers: false });
    expect(r2).toMatchObject({ created: 0, updated: 0, skipped: 3 });
    const v2 = v1.replace("50000,5000,55000", "60000,6000,66000").replace("30000,3000,33000,0,sent", "30000,3000,33000,0,void");
    const r3 = await importCleanupInvoices(db, otherMgr, { divisionId: dCln, fileName: "y.csv", text: v2, createCustomers: false });
    expect(r3).toMatchObject({ created: 0, updated: 2 });
    const rows = await db.select().from(sale).where(eq(sale.externalSource, "CLEANUP"));
    expect(rows).toHaveLength(2);
    expect(rows.find((s) => s.externalId === "INV-202609-001")!.amountExTax).toBe(60000);
    expect(rows.find((s) => s.externalId === "INV-202609-002")!.canceledAt).not.toBeNull();
    // 締め済みの月は更新しない（全件取り消し）
    await db.insert(monthClose).values({ month: "2026-09", closedAt: new Date(), isClosed: true });
    const r4 = await importCleanupInvoices(db, otherMgr, { divisionId: dCln, fileName: "z.csv", text: v2.replace("60000,6000,66000", "70000,7000,77000"), createCustomers: false });
    expect(r4.errors[0]).toMatch(/締め/);
    await db.execute(sql`delete from month_close`);
    // 列が違うCSVは拒否
    await expect(importCleanupInvoices(db, otherMgr, { divisionId: dCln, fileName: "w.csv", text: "請求書番号,取引先,発行日,作業日,品目\r\n", createCustomers: false })).rejects.toThrow(/品目別/);
  });
});

describe("セキュリティレビューの指摘への対応", () => {
  it("責任者は全社・他事業部の稼働希望受付を開閉できない", async () => {
    const db = getDb();
    const drvMgr = await makeUser("委託責任者", "MANAGER", { divisionIds: [dDrv] });
    await openPeriod(db, owner, { month: "2027-01", deadline: "2026-12-25T18:00" });
    await expect(closePeriod(db, drvMgr, "2027-01")).rejects.toThrow(/見つかりません/);
    await expect(openPeriod(db, drvMgr, { month: "2027-01", deadline: "2026-12-26T18:00", divisionId: dDrv })).rejects.toThrow(/担当外/);
    await openPeriod(db, drvMgr, { month: "2027-02", deadline: "2027-01-25T18:00", divisionId: dDrv });
    await expect(closePeriod(db, mgr, "2027-02")).rejects.toThrow(/見つかりません/);
    await closePeriod(db, drvMgr, "2027-02");
  });

  it("リマインド設定は経営者のみ、失敗メールの再送は担当事業部のみ", async () => {
    const db = getDb();
    await expect(saveReminderRules(db, mgr, [{ offsetDays: -1, hour: 9, enabled: true }])).rejects.toThrow(/経営者/);
    const [m] = await db.insert(emailOutbox).values({ dedupeKey: "t:1", kind: "AVAILABILITY_REMINDER", toUserId: drv.userId, toEmail: "x@example.test", subject: "s", body: "b", status: "FAILED" }).returning();
    await expect(retryEmail(db, mgr, m.id)).rejects.toThrow(/見つかりません/);
    await retryEmail(db, owner, m.id);
  });

  it("Clean Up取込で他事業部の売上を取消せない", async () => {
    const db = getDb();
    const cln2 = await makeDivision("CLN2", "清掃第二", "CLEANING");
    const m2 = await makeUser("第二責任者", "MANAGER", { divisionIds: [cln2] });
    const H = "請求書番号,取引先コード,取引先,発行日,期間開始,期間終了,支払期限,小計,消費税,合計,入金済,状態";
    const r = await importCleanupInvoices(db, m2, { divisionId: cln2, fileName: "v.csv", text: `${H}\r\nINV-202609-001,C001,x,2026-09-30,2026-09-01,2026-09-30,2026-10-31,1000,100,1100,0,void`, createCustomers: false });
    expect(r.errors[0]).toMatch(/別の事業部/);
    const [s] = await db.select().from(sale).where(eq(sale.externalId, "INV-202609-001"));
    expect(s.canceledAt).toBeNull();
  });

  it("CSVは全角記号・先頭空白の数式も無効化", () => {
    expect(csvCell("＝SUM(A1)").startsWith("'")).toBe(true);
    expect(csvCell("  =1+1").startsWith("'")).toBe(true);
    expect(csvCell("通常の文字")).toBe("通常の文字");
  });
});
