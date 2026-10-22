/**
 * Clean Up（清掃事業部の既存システム）との連携
 * - Clean Up 側のデータは読み取りのみ。こちらから Clean Up を変更することはない
 * - Clean Up には機械連携用のAPIがないため、Clean Up の請求書一覧から出力した CSV を取り込む
 *   （Clean Up の請求書CSV: 請求書番号,取引先コード,取引先,発行日,期間開始,期間終了,支払期限,小計,消費税,合計,入金済,状態）
 * - 請求書番号を外部IDとして保存し、再取込しても重複しない。内容が変わっていれば更新（締め済みの月は更新しない）
 * - 状態が void（無効）の請求書は取り込まず、取込済みなら売上を取消す
 * - 計上月は「期間終了日」（なければ発行日）の月。入金は銀行照合または手動で登録（Clean Up の入金済額は取り込まない）
 * - 外注費（Clean Up の支払明細）は自動取込しない。経費（外注費）として手入力し、支払明細番号を外部IDに入れる
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { division, partner, sale } from "@/db/schema";
import { type Actor, canAccessDivision, isCompanyWide } from "@/lib/access";
import { DATE_RE } from "@/lib/dates";
import { forbidden, invalid } from "@/lib/errors";
import { taxFromNet, type Rounding } from "@/lib/money";
import { writeAudit } from "./audit";
import { finishRun, parseCsv, stripGuard } from "./csv";
import { getSettings } from "./masters";
import { assertMonthOpen } from "./months";

export const CLEANUP_INVOICE_HEADER = ["請求書番号", "取引先コード", "取引先", "発行日", "期間開始", "期間終了", "支払期限", "小計", "消費税", "合計", "入金済", "状態"];
const SOURCE = "CLEANUP";

type Row = { line: number; no: string; customer: string; issued: string; periodEnd: string; due: string; subtotal: number; tax: number; status: string };

export async function importCleanupInvoices(db: DB, actor: Actor, opts: { divisionId: string; fileName: string; text: string; createCustomers: boolean }) {
  if (!isCompanyWide(actor) && actor.role !== "MANAGER") throw forbidden();
  if (!canAccessDivision(actor, opts.divisionId)) throw forbidden("担当外の事業部です");
  const [div] = await db.select().from(division).where(eq(division.id, opts.divisionId)).limit(1);
  if (!div || div.kind !== "CLEANING") throw invalid("清掃（Clean Up連携）の事業部を選んでください");
  const rows = parseCsv(opts.text).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) throw invalid("CSVが空です");
  const head = rows[0].map((h) => h.trim());
  if (head.includes("作業日") && head.includes("品目")) throw invalid("明細行のCSV（品目別）ではなく、請求書一覧の通常のCSVを取り込んでください");
  const idx = Object.fromEntries(CLEANUP_INVOICE_HEADER.map((h) => [h, head.indexOf(h)]));
  const lack = CLEANUP_INVOICE_HEADER.filter((h) => idx[h] < 0);
  if (lack.length) throw invalid(`Clean Up の請求書CSVの列がありません: ${lack.join("、")}`);
  const s = await getSettings(db);
  const rounding = s.taxRounding as Rounding;
  const errors: string[] = [];
  const items: Row[] = [];
  const yen = (v: string) => (/^-?\d+$/.test(v.replace(/,/g, "")) ? Number(v.replace(/,/g, "")) : NaN);
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const g = (h: string) => stripGuard((r[idx[h]] ?? "").trim());
    const it: Row = { line, no: g("請求書番号"), customer: g("取引先"), issued: g("発行日").replace(/\//g, "-"), periodEnd: g("期間終了").replace(/\//g, "-"), due: g("支払期限").replace(/\//g, "-"), subtotal: yen(g("小計")), tax: yen(g("消費税")), status: g("状態") };
    if (!it.no) return errors.push(`${line}行目: 請求書番号がありません`);
    if (!DATE_RE.test(it.issued)) return errors.push(`${line}行目: 発行日が正しくありません`);
    if (it.periodEnd && !DATE_RE.test(it.periodEnd)) return errors.push(`${line}行目: 期間終了が正しくありません`);
    if (it.due && !DATE_RE.test(it.due)) return errors.push(`${line}行目: 支払期限が正しくありません`);
    if (Number.isNaN(it.subtotal) || Number.isNaN(it.tax)) return errors.push(`${line}行目: 金額が正しくありません`);
    if (!["issued", "sent", "partially_paid", "paid", "void"].includes(it.status)) return errors.push(`${line}行目: 状態「${it.status}」は想定外です`);
    if (it.status !== "void" && it.subtotal <= 0) return errors.push(`${line}行目: 小計が0円以下です`);
    items.push(it);
  });
  if (new Set(items.map((x) => x.no)).size !== items.length) errors.push("同じ請求書番号の行が複数あります");
  if (errors.length) return finishRun(db, actor, "CLEANUP_INVOICES", opts.fileName, { created: 0, skipped: 0, errors });

  const rateOf = (it: Row) => ([10, 8, 0] as const).find((t) => taxFromNet(it.subtotal, t, rounding) === it.tax);
  const warnings: string[] = [];
  let created = 0, updated = 0, skipped = 0;
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(sale).where(and(eq(sale.externalSource, SOURCE), inArray(sale.externalId, items.map((x) => x.no))));
      const byNo = new Map(existing.map((e) => [e.externalId!, e]));
      const customers = await tx.select({ id: partner.id, name: partner.name }).from(partner).where(and(eq(partner.isCustomer, true), isNull(partner.archivedAt)));
      const cust = new Map(customers.map((c) => [c.name.trim(), c.id]));
      for (const it of items) {
        const prev = byNo.get(it.no);
        if (it.status === "void") {
          if (prev && !prev.canceledAt) {
            await assertMonthOpen(tx, prev.month, "売上");
            const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int n from receipt where sale_id = ${prev.id} and canceled_at is null`)).rows;
            if (n > 0) throw new Error(`${it.line}行目（${it.no}）: 無効になった請求書に入金が登録されています。入金を確認・取消してから取り込んでください`);
            await tx.update(sale).set({ canceledAt: new Date(), cancelReason: "Clean Up で無効（void）になったため" }).where(eq(sale.id, prev.id));
            await audit(tx, actor, prev.id, opts.divisionId, `Clean Up 請求書 ${it.no} が無効のため売上を取消`);
            updated++;
          } else skipped++;
          continue;
        }
        const taxRate = rateOf(it);
        if (taxRate === undefined) throw new Error(`${it.line}行目（${it.no}）: 消費税額から税率を判定できません（税率が混在している可能性）。手入力で登録してください`);
        const recognizedOn = it.periodEnd || it.issued;
        const month = recognizedOn.slice(0, 7);
        let customerId = cust.get(it.customer) ?? null;
        if (!customerId && it.customer) {
          if (opts.createCustomers) {
            const [p] = await tx.insert(partner).values({ name: it.customer, isCustomer: true }).returning({ id: partner.id });
            customerId = p.id;
            cust.set(it.customer, p.id);
            await writeAudit(tx, actor, { action: "partner.create", entityType: "partner", entityId: p.id, summary: `Clean Up 取込で顧客「${it.customer}」を登録` });
          } else warnings.push(`${it.no}: 顧客「${it.customer}」が未登録のため顧客なしで登録`);
        }
        const values = { recognizedOn, month, amountExTax: it.subtotal, taxRate, taxAmount: it.tax, expectedReceiptDate: it.due || null, billingStatus: "BILLED" as const, description: `Clean Up 請求 ${it.no}${it.customer ? `（${it.customer}）` : ""}` };
        if (!prev) {
          await assertMonthOpen(tx, month, "売上");
          const [r] = await tx.insert(sale).values({ ...values, divisionId: opts.divisionId, customerId, createdById: actor.userId, externalSource: SOURCE, externalId: it.no }).returning({ id: sale.id });
          await audit(tx, actor, r.id, opts.divisionId, `Clean Up 請求書 ${it.no} を売上として取込（${it.subtotal}円・税抜）`);
          created++;
          continue;
        }
        const same = prev.amountExTax === it.subtotal && prev.taxAmount === it.tax && prev.recognizedOn === recognizedOn && (prev.expectedReceiptDate ?? "") === (it.due || "") && !prev.canceledAt;
        if (same) {
          skipped++;
          continue;
        }
        if (prev.divisionId !== opts.divisionId) throw new Error(`${it.no}: 別の事業部の売上として取込済みです`);
        await assertMonthOpen(tx, prev.month, "売上");
        await assertMonthOpen(tx, month, "売上");
        await tx.update(sale).set({ ...values, canceledAt: null, cancelReason: null, customerId: prev.customerId ?? customerId }).where(eq(sale.id, prev.id));
        await audit(tx, actor, prev.id, opts.divisionId, `Clean Up 請求書 ${it.no} の変更を反映（${prev.amountExTax}→${it.subtotal}円）`);
        updated++;
      }
    });
  } catch (e) {
    return finishRun(db, actor, "CLEANUP_INVOICES", opts.fileName, { created: 0, skipped: 0, errors: [e instanceof Error ? e.message : "取込に失敗しました"] });
  }
  const r = await finishRun(db, actor, "CLEANUP_INVOICES", opts.fileName, { created, updated, skipped, errors: [] });
  return { ...r, warnings };
}

function audit(tx: Tx, actor: Actor, saleId: string, divisionId: string, summary: string) {
  return writeAudit(tx, actor, { action: "cleanup.import", entityType: "sale", entityId: saleId, divisionId, summary });
}
