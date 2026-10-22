/**
 * CSV入出力
 * - 出力: UTF-8（BOM付き）・CRLF。先頭が = + - @ タブ CR のセルは ' を付けて数式として実行されないようにする
 * - 取込: 1行でも誤りがあれば全件取り込まない（行番号つきでエラーを返す）。外部IDで重複取込を防ぐ
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { division, importRun, project, sale } from "@/db/schema";
import { type Actor, canAccessDivision, divisionScope, isCompanyWide } from "@/lib/access";
import { forbidden, invalid } from "@/lib/errors";
import { writeAudit } from "./audit";
import { createSale } from "./sales";

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 形式の簡易パーサー（ダブルクォート・改行入りセル対応） */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** 出力時に付けた ' を取り除く（数値・日付として読む列のみ） */
export function stripGuard(s: string) {
  return s.startsWith("'") && /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

/* ---------------- 出力 ---------------- */

export async function exportSalesCsv(db: DB, actor: Actor, from: string, to: string) {
  if (actor.role === "DRIVER") throw forbidden();
  const scope = divisionScope(actor);
  const r = await db.execute<Record<string, unknown>>(sql`
    select s.recognized_on, s.month, d.code division_code, d.name division_name, c.name customer, p.code project_code, s.description,
      s.amount_ex_tax, s.tax_rate, s.tax_amount, s.amount_ex_tax + s.tax_amount gross, s.billing_status, s.expected_receipt_date,
      coalesce((select sum(r.amount) from receipt r where r.sale_id = s.id and r.canceled_at is null), 0) received,
      case when s.canceled_at is null then '' else '取消' end canceled, coalesce(s.external_source, '') ext_src, coalesce(s.external_id, '') ext_id
    from sale s join division d on d.id = s.division_id left join partner c on c.id = s.customer_id left join project p on p.id = s.project_id
    where s.month between ${from} and ${to} ${scope ? (scope.length ? sql`and s.division_id in ${scope}` : sql`and false`) : sql``}
    order by s.recognized_on`);
  return toCsv(
    ["計上日", "計上月", "事業部コード", "事業部", "顧客", "案件コード", "内容", "売上金額（税抜）", "税率", "消費税", "税込金額", "請求状況", "入金予定日", "入金済み額", "取消", "取込元", "外部ID"],
    r.rows.map((x) => Object.values(x)),
  );
}

export async function exportExpensesCsv(db: DB, actor: Actor, from: string, to: string) {
  if (actor.role === "DRIVER") throw forbidden();
  const scope = divisionScope(actor);
  const r = await db.execute<Record<string, unknown>>(sql`
    select e.used_on, e.month, coalesce(d.code, 'COMMON') division_code, coalesce(d.name, '共通経費') division_name, p.code project_code, c.name category,
      u.name applicant, e.payee, e.purpose, e.amount, e.tax_rate, e.tax_amount, e.amount - e.tax_amount net, e.status, e.settlement,
      coalesce((select pa.status::text from payable pa where pa.source = 'EXPENSE' and pa.source_id = e.id and pa.status <> 'CANCELED' limit 1), case when e.statement_line_id is not null then 'STATEMENT' else '' end) pay_status,
      (select count(*) from stored_file f where f.owner_type = 'EXPENSE' and f.owner_id = e.id) files
    from expense e left join division d on d.id = e.division_id left join project p on p.id = e.project_id
      join expense_category c on c.id = e.category_id join app_user u on u.id = e.applicant_id
    where e.month between ${from} and ${to} ${scope ? (scope.length ? sql`and e.division_id in ${scope}` : sql`and false`) : sql``}
    order by e.used_on`);
  return toCsv(
    ["利用日", "計上月", "事業部コード", "事業部", "案件コード", "費目", "申請者", "支払先", "用途", "金額（税込）", "税率", "消費税", "税抜金額", "承認状況", "精算方法", "支払状況", "領収書数"],
    r.rows.map((x) => Object.values(x)),
  );
}

/* ---------------- 取込（売上） ---------------- */

export const SALES_IMPORT_HEADER = ["計上日", "事業部コード", "案件コード", "内容", "売上金額（税抜）", "税率", "入金予定日", "外部ID"];

export async function importSalesCsv(db: DB, actor: Actor, fileName: string, text: string) {
  if (!isCompanyWide(actor) && actor.role !== "MANAGER") throw forbidden();
  const rows = parseCsv(text);
  if (!rows.length) throw invalid("CSVが空です");
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  for (const h of SALES_IMPORT_HEADER.slice(0, 6)) if (idx(h) < 0) throw invalid(`列「${h}」がありません。見出し行は ${SALES_IMPORT_HEADER.join(",")} にしてください`);
  const divs = await db.select({ id: division.id, code: division.code }).from(division);
  const projs = await db.select({ id: project.id, code: project.code, divisionId: project.divisionId }).from(project);
  const errors: string[] = [];
  const items: { line: number; input: Parameters<typeof createSale>[2]; ext?: { source: string; id: string } }[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const g = (h: string) => stripGuard((r[idx(h)] ?? "").trim());
    const d = divs.find((x) => x.code === g("事業部コード"));
    if (!d) return errors.push(`${line}行目: 事業部コード「${g("事業部コード")}」が見つかりません`);
    if (!canAccessDivision(actor, d.id)) return errors.push(`${line}行目: 担当外の事業部です`);
    const pc = g("案件コード");
    const p = pc ? projs.find((x) => x.code === pc) : undefined;
    if (pc && !p) return errors.push(`${line}行目: 案件コード「${pc}」が見つかりません`);
    const extId = idx("外部ID") >= 0 ? g("外部ID") : "";
    items.push({
      line,
      input: { recognizedOn: g("計上日").replace(/\//g, "-"), divisionId: d.id, projectId: p?.id, description: g("内容"), amountExTax: g("売上金額（税抜）"), taxRate: Number(g("税率").replace("%", "")), expectedReceiptDate: idx("入金予定日") >= 0 ? g("入金予定日").replace(/\//g, "-") : undefined },
      ext: extId ? { source: "CSV", id: extId } : undefined,
    });
  });
  if (items.length > 2000) errors.push("一度に取り込めるのは2000行までです");
  const ids = items.filter((x) => x.ext).map((x) => x.ext!.id);
  const existing = ids.length ? await db.select({ id: sale.externalId }).from(sale).where(and(eq(sale.externalSource, "CSV"), inArray(sale.externalId, ids))) : [];
  const skip = new Set(existing.map((e) => e.id));
  if (errors.length) return finishRun(db, actor, "SALES_CSV", fileName, { created: 0, skipped: 0, errors });
  let created = 0;
  // 1行ずつ検証しながら登録し、どこかで失敗したら全件取り消す
  try {
    await db.transaction(async (tx) => {
      for (const it of items) {
        if (it.ext && skip.has(it.ext.id)) continue;
        try {
          await createSale(tx as unknown as DB, actor, it.input, it.ext);
          created++;
        } catch (e) {
          throw new Error(`${it.line}行目: ${e instanceof Error ? e.message : "登録できません"}`);
        }
      }
    });
  } catch (e) {
    return finishRun(db, actor, "SALES_CSV", fileName, { created: 0, skipped: 0, errors: [e instanceof Error ? e.message : "取込に失敗しました"] });
  }
  return finishRun(db, actor, "SALES_CSV", fileName, { created, skipped: skip.size, errors: [] });
}

async function finishRun(db: DB, actor: Actor, source: string, fileName: string, r: { created: number; skipped: number; errors: string[]; updated?: number }) {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(importRun)
      .values({ source, fileName: fileName.slice(0, 200), status: r.errors.length ? "FAILED" : "OK", created: r.created, updated: r.updated ?? 0, skipped: r.skipped, errors: r.errors.slice(0, 50), actorId: actor.userId, finishedAt: new Date() })
      .returning({ id: importRun.id });
    await writeAudit(tx, actor, { action: "import.run", entityType: "import_run", entityId: run.id, summary: `${source} 取込: 登録${r.created}件・更新${r.updated ?? 0}件・スキップ${r.skipped}件${r.errors.length ? `・エラー${r.errors.length}件（取込せず）` : ""}` });
  });
  return r;
}

export { finishRun };
