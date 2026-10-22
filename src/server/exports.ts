import "server-only";
/**
 * Excel 出力（スケジュール・稼働明細）
 * - 文字列は数式として扱われないように保存し、先頭が = + - @ の文字列には ' を付ける（数式インジェクション対策）
 * - 権限は呼び出し元のサービス関数（scheduleRows / getStatement）で判定済みのデータだけを出力
 */
import ExcelJS from "exceljs";
import type { DB } from "@/db";
import type { Actor } from "@/lib/access";
import { formatDate, weekdayJa } from "@/lib/dates";
import { L } from "@/lib/labels";
import { scheduleRows } from "./shifts";
import { getStatement } from "./statements";

const NAVY = "FF1F3052";

function safe(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  return /^[\s\u3000]*[=+\-@\t\r＝＋－＠]/.test(s) ? `'${s}` : s;
}

function header(ws: ExcelJS.Worksheet, cols: { header: string; key: string; width: number }[]) {
  ws.columns = cols;
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addRows(ws: ExcelJS.Worksheet, rows: Record<string, unknown>[]) {
  for (const r of rows) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)])));
}

export type ScheduleScope = { kind: "all" } | { kind: "division"; id: string } | { kind: "project"; id: string } | { kind: "driver"; id: string };

/** スケジュールの Excel（月全体・事業部別・案件別・ドライバー別。ドライバー本人は自分の確定分のみ） */
export async function scheduleWorkbook(db: DB, actor: Actor, month: string, scope: ScheduleScope) {
  const rows = await scheduleRows(db, actor, {
    month,
    divisionId: scope.kind === "division" ? scope.id : undefined,
    projectId: scope.kind === "project" ? scope.id : undefined,
    driverId: scope.kind === "driver" ? scope.id : undefined,
    confirmedOnly: actor.role === "DRIVER",
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = "経営管理システム";
  const ws = wb.addWorksheet(`${month} スケジュール`);
  header(ws, [
    { header: "日付", key: "date", width: 12 },
    { header: "曜日", key: "wd", width: 6 },
    { header: "開始", key: "start", width: 8 },
    { header: "終了", key: "end", width: 8 },
    { header: "事業部", key: "division", width: 18 },
    { header: "案件コード", key: "code", width: 12 },
    { header: "案件", key: "project", width: 24 },
    { header: "エリア", key: "area", width: 12 },
    { header: "ドライバー", key: "driver", width: 14 },
    { header: "状態", key: "status", width: 8 },
  ]);
  addRows(ws, rows.map((r) => ({ date: r.date, wd: weekdayJa(r.date), start: r.start.slice(0, 5), end: r.end.slice(0, 5), division: r.divisionName, code: r.projectCode, project: r.projectName, area: r.area ?? "", driver: r.driverName, status: r.status === "CONFIRMED" ? "確定" : "下書き" })));
  // ドライバー別の集計シート（会社側のみ）
  if (actor.role !== "DRIVER") {
    const sum = wb.addWorksheet("ドライバー別集計");
    header(sum, [{ header: "ドライバー", key: "driver", width: 16 }, { header: "稼働日数", key: "days", width: 10 }, { header: "件数", key: "n", width: 8 }]);
    const m = new Map<string, { days: Set<string>; n: number }>();
    for (const r of rows) {
      const x = m.get(r.driverName) ?? { days: new Set(), n: 0 };
      x.days.add(r.date);
      x.n++;
      m.set(r.driverName, x);
    }
    addRows(sum, [...m.entries()].map(([driver, x]) => ({ driver, days: x.days.size, n: x.n })));
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count: rows.length };
}

/** 稼働明細の Excel */
export async function statementWorkbook(db: DB, actor: Actor, id: string) {
  const st = await getStatement(db, actor, id);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("稼働明細");
  ws.addRow([safe(`稼働明細 ${st.s.month}（第${st.s.version}版）`)]).font = { bold: true, size: 14 };
  ws.addRow([safe(`${st.driverName} 様`), null, null, safe(`状態: ${L.statement[st.s.status][0]}`)]);
  ws.addRow([]);
  const h = ws.addRow(["日付", "区分", "内容", "数量", "単位", "単価", "金額"]);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  for (const { l } of st.lines) ws.addRow([safe(l.workDate ? formatDate(l.workDate) : ""), safe(l.kind === "WORK" ? "稼働" : l.kind === "ADJUSTMENT" ? "調整" : "立替経費"), safe(l.description), Number(l.quantity), safe(l.unit), l.unitPrice, l.amount]);
  ws.addRow([]);
  const sums: [string, number][] = [["稼働分（税抜）", st.s.workAmount], ["調整", st.s.adjustmentAmount], ["消費税", st.s.taxAmount], ["源泉徴収", -st.s.withholdingAmount], ["立替経費", st.s.expenseAmount], ["お支払額", st.s.payAmount]];
  for (const [k, v] of sums) ws.addRow([null, null, null, null, null, safe(k), v]).font = k === "お支払額" ? { bold: true } : {};
  ws.columns.forEach((c, i) => (c.width = [12, 10, 44, 8, 6, 14, 14][i]));
  for (const col of [6, 7]) ws.getColumn(col).numFmt = "#,##0";
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), name: `statement_${st.s.month}_v${st.s.version}.xlsx` };
}
