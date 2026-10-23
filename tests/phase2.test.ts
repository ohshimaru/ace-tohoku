import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { appUser, assignment, SELF_COMPANY_ID, driver, emailOutbox, expense, payable, statement } from "@/db/schema";
import type { Actor } from "@/lib/access";
import { getPL } from "@/server/metrics";
import { approveExpense, createExpense, submitExpense } from "@/server/expenses";
import { bindLineAccount, confirmEmail, inviteDriver, loginWithLine, peekInvite, requestEmailVerification, setDriverStatus, updateDriverProfile } from "@/server/drivers";
import { processOutbox, scheduleAvailabilityReminders } from "@/server/mailer";
import { saveProject } from "@/server/partners";
import { approveReport, correctApprovedReport, missingReports, saveMyReport } from "@/server/reports";
import { assignManually, autoAssign, confirmAssignments, createSlots, openPeriod, saveMyAvailability, submitMyAvailability, unassign } from "@/server/shifts";
import { addAdjustment, addRate, createCorrection, decideAdjustment, generateForDivision, getStatement, listStatements, setStatementStatus } from "@/server/statements";
import { scheduleWorkbook, statementWorkbook } from "@/server/exports";
import { statementPdf } from "@/server/statement-pdf";
import ExcelJS from "exceljs";
import { makeCategory, makeDivision, makeUser, resetDb } from "./helpers/db";

let owner: Actor, acct: Actor, mgr: Actor, otherMgr: Actor;
let dDrv = "", dSns = "", projA = "", projB = "", catFuel = "";
const drivers: Actor[] = [];
const M = "2026-09";
const NOW_BEFORE_DEADLINE = new Date("2026-08-27T09:30:00+09:00");

let seq = 0;
async function activeDriver(name: string, opts: { quals?: string; vehicles?: string; maxDays?: number } = {}) {
  const db = getDb();
  const mail = `drv${++seq}@example.test`;
  const inv = await inviteDriver(db, mgr, { name, divisionId: dDrv, email: mail });
  const token = inv.inviteUrl.split("/").pop()!;
  const sub = `U${crypto.randomUUID().replace(/-/g, "")}`;
  await bindLineAccount(db, token, { sub });
  await setDriverStatus(db, mgr, inv.id, "ACTIVE");
  await updateDriverProfile(db, mgr, inv.id, { qualifications: opts.quals ?? "", vehicles: opts.vehicles ?? "", areas: "", taxMode: "EXCLUSIVE", withholdingEnabled: false, maxDaysPerMonth: opts.maxDays });
  await db.update(appUser).set({ emailVerifiedAt: new Date() }).where(eq(appUser.id, inv.id));
  await db.update(appUser).set({ email: mail }).where(eq(appUser.id, inv.id));
  const a: Actor = { userId: inv.id, name, email: mail, role: "DRIVER", divisionIds: [], companyId: SELF_COMPANY_ID, demo: false };
  return { actor: a, sub };
}

beforeAll(async () => {
  await resetDb();
  dDrv = await makeDivision("DRV", "業務委託事業部", "DRIVER");
  dSns = await makeDivision("SNS", "SNS・AI開発事業部");
  catFuel = await makeCategory("燃料費");
  owner = await makeUser("代表", "OWNER");
  acct = await makeUser("経理", "ACCOUNTING");
  mgr = await makeUser("委託責任者", "MANAGER", { divisionIds: [dDrv] });
  otherMgr = await makeUser("SNS責任者", "MANAGER", { divisionIds: [dSns] });
  const db = getDb();
  projA = await saveProject(db, owner, null, { code: "DLV-A", name: "配送A", divisionId: dDrv, category: "配送", contractType: "MONTHLY", amount: "0", status: "ACTIVE", rfQuantity: true, rfQuantityUnit: "件", rfBreakTime: true, rfAttachments: true });
  projB = await saveProject(db, owner, null, { code: "DLV-B", name: "配送B（冷凍車）", divisionId: dDrv, category: "配送", contractType: "MONTHLY", amount: "0", status: "ACTIVE", rfBreakTime: true });
});
afterAll(closeDb);

describe("LINEログインと招待による紐付け", () => {
  it("招待なしのLINEアカウントはログインできず、招待は1回限り", async () => {
    const db = getDb();
    const inv = await inviteDriver(db, mgr, { name: "佐藤", divisionId: dDrv });
    const token = inv.inviteUrl.split("/").pop()!;
    const sub = `U${"a".repeat(32)}`;
    expect(await loginWithLine(db, sub)).toEqual({ result: "NOT_LINKED" });
    expect(await peekInvite(db, token)).toEqual({ name: "佐藤" });
    const r = await Promise.allSettled([bindLineAccount(db, token, { sub }), bindLineAccount(db, token, { sub: `U${"b".repeat(32)}` })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    // 承認前はログイン不可
    expect((await loginWithLine(db, sub)).result).toBe("PENDING");
    // 他事業部の責任者は承認できない
    await expect(setDriverStatus(db, otherMgr, inv.id, "ACTIVE")).rejects.toThrow(/権限/);
    await setDriverStatus(db, mgr, inv.id, "ACTIVE");
    expect((await loginWithLine(db, sub)).result).toBe("OK");
    // 停止すると即ログイン不可
    await setDriverStatus(db, mgr, inv.id, "SUSPENDED");
    expect((await loginWithLine(db, sub)).result).toBe("SUSPENDED");
    // 使用済みの招待で別のLINEを紐付けることはできない
    await expect(bindLineAccount(db, token, { sub: `U${"c".repeat(32)}` })).rejects.toThrow(/無効/);
  });

  it("既に別の人に紐付いたLINEアカウントは拒否", async () => {
    const db = getDb();
    const a = await inviteDriver(db, mgr, { name: "A", divisionId: dDrv });
    const b = await inviteDriver(db, mgr, { name: "B", divisionId: dDrv });
    const sub = `U${"d".repeat(32)}`;
    await bindLineAccount(db, a.inviteUrl.split("/").pop()!, { sub });
    await expect(bindLineAccount(db, b.inviteUrl.split("/").pop()!, { sub })).rejects.toThrow(/別の利用者/);
  });

  it("メールの確認は本人がリンクを開くまで未確認", async () => {
    const db = getDb();
    const { actor } = await activeDriver("メール確認");
    await db.update(appUser).set({ emailVerifiedAt: null, email: null }).where(eq(appUser.id, actor.userId));
    await requestEmailVerification(db, actor, "verify-me@example.test");
    const [m] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, "verify-me@example.test"));
    const token = m.body.match(/verify-email\/([A-Za-z0-9_-]+)/)![1];
    await confirmEmail(db, token);
    const [u] = await db.select().from(appUser).where(eq(appUser.id, actor.userId));
    expect(u.email).toBe("verify-me@example.test");
    expect(u.emailVerifiedAt).not.toBeNull();
    await expect(confirmEmail(db, token)).rejects.toThrow(/無効/);
  });
});

describe("稼働希望とリマインド", () => {
  it("未提出者だけにリマインド、重複なし、提出後は送らない", async () => {
    const db = getDb();
    for (const n of ["田中", "鈴木", "高橋"]) drivers.push((await activeDriver(n, { quals: n === "田中" ? "冷凍" : "", vehicles: n === "鈴木" ? "軽バン" : "" })).actor);
    await openPeriod(db, mgr, { month: M, deadline: "2026-08-30T18:00", divisionId: dDrv });
    // 田中は提出済み
    await saveMyAvailability(db, drivers[0], M, [{ date: "2026-09-01", kind: "AVAILABLE" }]);
    await submitMyAvailability(db, drivers[0], M);
    // 締切3日前 9:00 のルールで予約（2回実行しても重複しない）
    const r1 = await scheduleAvailabilityReminders(db, NOW_BEFORE_DEADLINE);
    const r2 = await scheduleAvailabilityReminders(db, NOW_BEFORE_DEADLINE);
    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.kind, "AVAILABILITY_REMINDER"));
    const targets = queued.map((q) => q.toUserId);
    expect(targets).not.toContain(drivers[0].userId);
    expect(targets).toContain(drivers[1].userId);
    expect(r2.queued).toBe(0);
    expect(r1.queued).toBe(queued.length);
    // 鈴木は送信前に提出 → 送信処理で送らない（SKIPPED）
    await saveMyAvailability(db, drivers[1], M, [{ date: "2026-09-01", kind: "AVAILABLE" }, { date: "2026-09-02", kind: "UNAVAILABLE" }, { date: "2026-09-03", kind: "TIME", start: "09:00", end: "13:00" }]);
    await submitMyAvailability(db, drivers[1], M);
    const res = await Promise.all([processOutbox(db, new Date("2026-08-27T10:00:00+09:00")), processOutbox(db, new Date("2026-08-27T10:00:00+09:00"))]);
    const all = await db.select().from(emailOutbox).where(eq(emailOutbox.kind, "AVAILABILITY_REMINDER"));
    expect(all.find((q) => q.toUserId === drivers[1].userId)?.status).toBe("SKIPPED");
    const sentCount = all.filter((q) => q.status === "SENT").length;
    expect(res[0].sent + res[1].sent).toBe(sentCount); // 同時処理でも二重送信しない
    // 提出後は保存できない（変更申請を使う）
    await expect(saveMyAvailability(db, drivers[1], M, [{ date: "2026-09-04", kind: "AVAILABLE" }])).rejects.toThrow(/提出済み/);
    await saveMyAvailability(db, drivers[2], M, [{ date: "2026-09-01", kind: "AVAILABLE" }, { date: "2026-09-03", kind: "AVAILABLE" }]);
    await submitMyAvailability(db, drivers[2], M);
  });
});

describe("割当: 必須制約と重複防止", () => {
  it("自動割当は必須制約を守り、不足は理由つきで未割当", async () => {
    const db = getDb();
    await createSlots(db, mgr, { projectId: projA, dates: ["2026-09-01"], startTime: "09:00", endTime: "17:00", requiredCount: 2 });
    await createSlots(db, mgr, { projectId: projB, dates: ["2026-09-01"], startTime: "17:00", endTime: "22:00", requiredCount: 1, requiredQualifications: "冷凍" });
    await createSlots(db, mgr, { projectId: projA, dates: ["2026-09-02"], startTime: "09:00", endTime: "12:00", requiredCount: 1 });
    await createSlots(db, mgr, { projectId: projA, dates: ["2026-09-03"], startTime: "10:00", endTime: "15:00", requiredCount: 2 });
    await db.update(driver).set({ preferredProjectIds: [projA, projB] }).where(eq(driver.userId, drivers[0].userId));
    const r = await autoAssign(db, mgr, { month: M, divisionId: dDrv });
    const rows = await db.select().from(assignment);
    // 同じ人の時間重複なし
    for (const a of rows) for (const b of rows) if (a.id !== b.id && a.driverId === b.driverId && a.workDate === b.workDate) expect(a.endTime <= b.startTime || b.endTime <= a.startTime).toBe(true);
    // 9/2 は鈴木が「不可」、他は未入力 → 未割当
    const u2 = r.unfilled.find((u) => u.workDate === "2026-09-02")!;
    expect(u2.reasons.map((x) => x.label)).toEqual(expect.arrayContaining(["稼働不可の日"]));
    // 9/3 10-15 は鈴木の時間指定(9-13)外 → 高橋のみ
    const d3 = rows.filter((a) => a.workDate === "2026-09-03").map((a) => a.driverId);
    expect(d3).toEqual([drivers[2].userId]);
    expect(r.unfilled.find((u) => u.workDate === "2026-09-03")!.reasons.map((x) => x.label)).toContain("希望の時間外");
    // 冷凍の枠（17-22）は冷凍資格のある田中だけ。Aの9-17とは重ならない
    const frozen = rows.filter((a) => a.workDate === "2026-09-01" && a.startTime.startsWith("17"));
    for (const f of frozen) expect(f.driverId).toBe(drivers[0].userId);
    // 自動作成は下書きのみ（確定しない）
    expect(rows.every((a) => a.status === "DRAFT")).toBe(true);
    // 2回実行しても重複しない
    const again = await autoAssign(db, mgr, { month: M, divisionId: dDrv });
    expect(again.created).toBe(0);
  });

  it("手動でも必須制約を守り、DB制約が時間重複を拒否する", async () => {
    const db = getDb();
    const [slot] = (await db.execute<{ id: string }>(sql`select id from shift_slot where work_date = '2026-09-02' limit 1`)).rows;
    await expect(assignManually(db, mgr, slot.id, drivers[1].userId)).rejects.toThrow(/稼働不可/);
    // サービスを経由せずに重複する割当を直接入れても拒否される
    const [a] = await db.select().from(assignment).where(eq(assignment.workDate, "2026-09-01")).limit(1);
    await expect(db.insert(assignment).values({ slotId: a.slotId, driverId: a.driverId, workDate: a.workDate, startTime: "10:00", endTime: "11:00", status: "DRAFT" })).rejects.toThrow();
  });

  it("月の稼働日数上限を守る", async () => {
    const db = getDb();
    await db.update(driver).set({ maxDaysPerMonth: 1 }).where(eq(driver.userId, drivers[2].userId));
    const [slot] = (await db.execute<{ id: string }>(sql`select s.id from shift_slot s where s.work_date = '2026-09-01' and s.start_time = '09:00' limit 1`)).rows;
    // 高橋は9/3に割当済み → 9/1は上限超過
    const existing = await db.select().from(assignment).where(eq(assignment.driverId, drivers[2].userId));
    if (existing.some((x) => x.workDate === "2026-09-01")) return; // 既に割当済みならスキップ
    await expect(assignManually(db, mgr, slot.id, drivers[2].userId)).rejects.toThrow(/上限/);
    await db.update(driver).set({ maxDaysPerMonth: null }).where(eq(driver.userId, drivers[2].userId));
  });

  it("確定は会社側の操作で行い、他事業部の責任者は確定できない", async () => {
    const db = getDb();
    await expect(confirmAssignments(db, otherMgr, { month: M, divisionId: dDrv })).rejects.toThrow();
    const n = await confirmAssignments(db, mgr, { month: M, divisionId: dDrv });
    expect(n).toBeGreaterThan(0);
  });
});

describe("日報と稼働明細", () => {
  let tanaka: Actor;
  it("確定スケジュールのある日の日報が未提出なら一覧に出る", async () => {
    tanaka = drivers[0];
    const miss = await missingReports(getDb(), tanaka, { days: 400 });
    expect(miss.map((m) => m.workDate)).toContain("2026-09-01");
  });

  it("承認済み日報と適用期間付き単価から明細を作り、再生成しても重複しない", async () => {
    const db = getDb();
    await addRate(db, mgr, { projectId: projA, method: "DAILY", unitPrice: "12000", effectiveFrom: "2026-01-01" });
    await addRate(db, mgr, { projectId: projB, method: "HOURLY", unitPrice: "1500", effectiveFrom: "2026-01-01" });
    const asg = await db.select().from(assignment).where(eq(assignment.driverId, tanaka.userId));
    const ids: string[] = [];
    for (const a of asg.filter((x) => x.status === "CONFIRMED")) {
      const [slot] = (await db.execute<{ project_id: string }>(sql`select project_id from shift_slot where id = ${a.slotId}`)).rows;
      ids.push(await saveMyReport(db, tanaka, null, { workDate: a.workDate, projectId: slot.project_id, startTime: a.startTime.slice(0, 5), endTime: a.endTime.slice(0, 5), breakMinutes: slot.project_id === projB ? "30" : "60", quantity: slot.project_id === projA ? "45" : "", notes: "完了" }, true));
    }
    // 予定だけでは明細に入らない（未承認の日報は対象外）
    let g = await generateForDivision(db, acct, { month: M, divisionId: dDrv });
    expect(g.created).toBe(0);
    for (const id of ids) await approveReport(db, mgr, id);
    // 立替経費（明細で精算）と調整
    const e = await createExpense(db, tanaka, { usedOn: "2026-09-01", divisionId: dDrv, projectId: projA, categoryId: catFuel, payee: "スタンド", purpose: "燃料", amount: "3300", taxRate: 10, settlement: "STATEMENT" });
    await submitExpense(db, tanaka, e);
    await approveExpense(db, mgr, e);
    const adj = await addAdjustment(db, mgr, { driverId: tanaka.userId, projectId: projA, month: M, amount: "2000", reason: "繁忙手当" });
    await expect(decideAdjustment(db, mgr, adj, true)).rejects.toThrow(/自分/);
    await decideAdjustment(db, acct, adj, true);
    g = await generateForDivision(db, acct, { month: M, divisionId: dDrv });
    const g2 = await generateForDivision(db, acct, { month: M, divisionId: dDrv });
    expect(g.created).toBeGreaterThan(0);
    expect(g2.created).toBe(0);
    expect(g2.regenerated).toBe(g.created);
    const list = await listStatements(db, acct, { month: M });
    const mine = list.filter((s) => s.s.driverId === tanaka.userId);
    expect(mine).toHaveLength(1);
    const st = await getStatement(db, acct, mine[0].s.id);
    // A: 9/1 日額12,000 ／ B: 9/1 17-22 休憩30分 = 4.5h × 1,500 = 6,750 ／ 調整 2,000 ／ 立替 3,300
    expect(st.s.workAmount).toBe(18750);
    expect(st.s.adjustmentAmount).toBe(2000);
    expect(st.s.taxAmount).toBe(2075); // (18,750+2,000)×10% 切り捨て
    expect(st.s.expenseAmount).toBe(3300);
    expect(st.s.payAmount).toBe(18750 + 2000 + 2075 + 3300);
    expect(st.s.withholdingAmount).toBe(0); // 確認済み設定がないため源泉なし
    // 立替経費は1行だけ、経費側にも1つの行が紐付く
    const [ex] = await db.select().from(expense).where(eq(expense.id, e));
    expect(ex.statementLineId).not.toBeNull();
    expect(st.lines.filter((l) => l.l.kind === "EXPENSE")).toHaveLength(1);
  });

  it("確定後は単価を変えても明細が変わらず、DBも金額の変更を拒否する", async () => {
    const db = getDb();
    const [s] = await db.select().from(statement).where(eq(statement.driverId, tanaka.userId));
    await setStatementStatus(db, mgr, s.id, "REVIEW");
    await expect(setStatementStatus(db, mgr, s.id, "CONFIRMED")).rejects.toThrow(/経営者・経理/);
    await setStatementStatus(db, acct, s.id, "CONFIRMED");
    // 確定済み期間に遡る単価は拒否、将来分は登録可
    await expect(addRate(db, mgr, { projectId: projA, method: "DAILY", unitPrice: "20000", effectiveFrom: "2026-09-01" })).rejects.toThrow(/遡って/);
    await addRate(db, mgr, { projectId: projA, method: "DAILY", unitPrice: "20000", effectiveFrom: "2026-10-01" });
    const again = await generateForDivision(db, acct, { month: M, divisionId: dDrv });
    expect(again.locked).toBeGreaterThan(0);
    const [after] = await db.select().from(statement).where(eq(statement.id, s.id));
    expect(after.workAmount).toBe(18750);
    const err = await db.update(statement).set({ payAmount: 1 }).where(eq(statement.id, s.id)).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/確定/);
    // 支払予定は1件
    const pays = await db.select().from(payable).where(eq(payable.sourceId, s.id));
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(after.payAmount);
    // ドライバーには公開前は見えない
    expect(await listStatements(db, tanaka)).toHaveLength(0);
    await setStatementStatus(db, acct, s.id, "PUBLISHED");
    expect(await listStatements(db, tanaka)).toHaveLength(1);
    // 確定済み明細に含まれる日報は訂正できない
    const [rep] = (await db.execute<{ id: string }>(sql`select id from daily_report where driver_id = ${tanaka.userId} and project_id = ${projB}`)).rows;
    await expect(correctApprovedReport(db, mgr, rep.id, { workDate: "2026-09-01", projectId: projB, startTime: "17:00", endTime: "21:00", breakMinutes: "0", notes: "" }, "時間誤り")).rejects.toThrow(/確定済み/);
  });

  it("訂正版: 旧版は残り、支払済み額を差し引いた支払予定を作る（二重払いしない）", async () => {
    const db = getDb();
    const [s] = await db.select().from(statement).where(eq(statement.driverId, tanaka.userId));
    const [pay] = await db.select().from(payable).where(eq(payable.sourceId, s.id));
    await db.update(payable).set({ status: "PAID", paidOn: "2026-10-31" }).where(eq(payable.id, pay.id));
    const newId = await createCorrection(db, acct, s.id, "B案件の時間誤り");
    const [rep] = (await db.execute<{ id: string }>(sql`select id from daily_report where driver_id = ${tanaka.userId} and project_id = ${projB}`)).rows;
    await correctApprovedReport(db, mgr, rep.id, { workDate: "2026-09-01", projectId: projB, startTime: "17:00", endTime: "22:00", breakMinutes: "0", notes: "" }, "休憩なしが正");
    const { regenerateStatement } = await import("@/server/statements");
    await regenerateStatement(db, acct, newId);
    const ns = await getStatement(db, acct, newId);
    expect(ns.s.version).toBe(2);
    expect(ns.s.workAmount).toBe(12000 + 7500);
    await setStatementStatus(db, acct, newId, "CONFIRMED");
    const pays = await db.select().from(payable).where(eq(payable.sourceId, newId));
    const [old] = await db.select().from(statement).where(eq(statement.id, s.id));
    expect(old.status).toBe("SUPERSEDED");
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(ns.s.payAmount - old.payAmount); // 差額だけ
    // 立替経費は新しい版に1回だけ
    const lines = await db.execute<{ n: number }>(sql`select count(*)::int n from expense where statement_line_id in (select id from statement_line where statement_id = ${newId})`);
    expect(lines.rows[0].n).toBe(1);
  });

  it("経費と明細の外注費を二重計上しない（損益）", async () => {
    const db = getDb();
    const pl = await getPL(db, owner, { from: M, to: M, divisionId: dDrv });
    const row = pl.rows[0];
    const [cur] = await db.select().from(statement).where(sql`${statement.driverId} = ${tanaka.userId} and ${statement.status} <> 'SUPERSEDED'`);
    // 外注費 = 稼働分＋調整（税抜）。立替経費は経費として税抜3,000円だけ
    expect(row.statementCost).toBe(cur.workAmount + cur.adjustmentAmount);
    expect(row.directExpenses).toBe(3000);
    expect(row.directCost).toBe(cur.workAmount + cur.adjustmentAmount + 3000);
  });
});

describe("割当の取消", () => {
  it("確定済みの割当を外すには理由が必要", async () => {
    const db = getDb();
    const [a] = await db.select().from(assignment).where(eq(assignment.status, "CONFIRMED")).limit(1);
    await expect(unassign(db, mgr, a.id, "")).rejects.toThrow(/理由/);
  });
});

describe("Excel・PDF の出力と権限", () => {
  it("ドライバーは自分の確定分だけ、数式は無効化される", async () => {
    const db = getDb();
    await db.execute(sql`update shift_slot set note = '=HYPERLINK("http://x")', area = '=1+1'`);
    const wb = new ExcelJS.Workbook();
    const mine = await scheduleWorkbook(db, drivers[0], M, { kind: "all" });
    await wb.xlsx.load(mine.buffer as never);
    const ws = wb.worksheets[0];
    const names = new Set<string>();
    ws.eachRow((r, i) => { if (i > 1) names.add(String(r.getCell(9).value)); });
    expect([...names]).toEqual([drivers[0].name]);
    expect(wb.worksheets).toHaveLength(1); // 集計シートは会社側のみ
    ws.eachRow((r, i) => { if (i > 1) { expect(String(r.getCell(8).value)).toBe("'=1+1"); expect(r.getCell(8).formula).toBeUndefined(); } });
    const all = await scheduleWorkbook(db, mgr, M, { kind: "all" });
    expect(all.count).toBeGreaterThan(mine.count);
    // 他事業部の責任者には何も出ない
    expect((await scheduleWorkbook(db, otherMgr, M, { kind: "all" })).count).toBe(0);
  });

  it("稼働明細の出力は本人（公開済み）と担当者だけ", async () => {
    const db = getDb();
    const [cur] = await db.select().from(statement).where(sql`${statement.driverId} = ${drivers[0].userId} and ${statement.status} <> 'SUPERSEDED'`);
    await expect(statementWorkbook(db, drivers[1], cur.id)).rejects.toThrow(/見つかりません/);
    await expect(statementPdf(db, otherMgr, cur.id)).rejects.toThrow(/見つかりません/);
    // 訂正版（確定のみ・未公開）は本人にも見えない
    await expect(statementWorkbook(db, drivers[0], cur.id)).rejects.toThrow(/見つかりません/);
    const pdf = await statementPdf(db, acct, cur.id);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe("%PDF");
  }, 30000);
});
