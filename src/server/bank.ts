/**
 * 銀行口座・取引・照合
 * - 口座番号は下4桁だけ保存（全桁・ログイン情報は保存しない）。送金・振込は行わない
 * - 取引は (口座, 取引ID) で一意。同期・CSV取込を何度行っても重複しない
 * - 照合: 入金 ↔ 入金記録（売上）、出金 ↔ 支払予定。1つの入金記録・支払予定は1取引までに照合
 * - 銀行残高は「お金の実際の残高」。予算の使用可能額とは別に扱う（予算から残高は引かない）
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { bankAccount, bankMatch, bankSyncRun, bankTransaction, payable, receipt } from "@/db/schema";
import { providerFor } from "@/adapters/bank";
import { type Actor, can } from "@/lib/access";
import { addDays, DATE_RE, todayJst } from "@/lib/dates";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { parseCsv, stripGuard } from "./csv";
import { assertMonthOpen } from "./months";
import { addReceipt } from "./sales";
import { parse, zText } from "./validate";

const view = (a: Actor) => {
  if (!can.viewBank(a)) throw forbidden("銀行口座は経営者・経理のみ扱えます");
};
const manage = (a: Actor) => {
  if (!can.manageBank(a)) throw forbidden("銀行口座は経営者・経理のみ扱えます");
};

/* ---------------- 口座 ---------------- */

const accountInput = z.object({
  bankName: zText("銀行名", 50),
  branchName: zText("支店名", 50),
  accountType: z.enum(["普通", "当座", "貯蓄"]).default("普通"),
  accountNumberLast4: z.string().regex(/^\d{4}$/, "口座番号は下4桁だけを数字で入力してください（全桁は保存しません）"),
  holderName: z.string().trim().max(100).default(""),
  provider: z.enum(["CSV", "DEMO"]).default("CSV"),
  openingBalance: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional()).optional(),
});

export async function createBankAccount(db: DB, actor: Actor, raw: z.input<typeof accountInput>) {
  manage(actor);
  const input = parse(accountInput, raw);
  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(bankAccount)
      .values({ bankName: input.provider === "DEMO" ? `【デモ】${input.bankName}` : input.bankName, branchName: input.branchName, accountType: input.accountType, accountNumberLast4: input.accountNumberLast4, holderName: input.holderName, provider: input.provider, isDemo: input.provider === "DEMO", balance: input.openingBalance ?? null, balanceAsOf: input.openingBalance != null ? new Date() : null })
      .returning({ id: bankAccount.id });
    await writeAudit(tx, actor, { action: "bank.account_create", entityType: "bank_account", entityId: a.id, summary: `銀行口座 ${input.bankName} ${input.branchName} ****${input.accountNumberLast4} を登録（${input.provider === "DEMO" ? "デモ" : "CSV取込"}）` });
    return a.id;
  });
}

export async function archiveBankAccount(db: DB, actor: Actor, id: string) {
  manage(actor);
  await db.transaction(async (tx) => {
    const [a] = await tx.update(bankAccount).set({ archivedAt: new Date() }).where(and(eq(bankAccount.id, id), isNull(bankAccount.archivedAt))).returning();
    if (!a) throw notFound();
    await writeAudit(tx, actor, { action: "bank.account_archive", entityType: "bank_account", entityId: id, summary: `銀行口座 ${a.bankName} ****${a.accountNumberLast4} を非表示` });
  });
}

export async function listBankAccounts(db: DB, actor: Actor) {
  view(actor);
  return db
    .select({ a: bankAccount, unmatched: sql<number>`(select count(*)::int from bank_transaction t where t.account_id = ${bankAccount.id} and t.classification in ('UNCLASSIFIED','SALES_RECEIPT','EXPENSE_PAYMENT','STATEMENT_PAYMENT') and not exists (select 1 from bank_match m where m.transaction_id = t.id and m.unmatched_at is null))` })
    .from(bankAccount)
    .where(isNull(bankAccount.archivedAt))
    .orderBy(asc(bankAccount.bankName));
}

/* ---------------- 同期・取込 ---------------- */

async function insertTxns(tx: Tx, accountId: string, rows: { externalId: string; txnDate: string; amount: number; description: string; balanceAfter: number | null }[]) {
  if (!rows.length) return { imported: 0, skipped: 0 };
  const r = await tx
    .insert(bankTransaction)
    .values(rows.map((x) => ({ ...x, accountId })))
    .onConflictDoNothing({ target: [bankTransaction.accountId, bankTransaction.externalId] })
    .returning({ id: bankTransaction.id });
  return { imported: r.length, skipped: rows.length - r.length };
}

/** 同期（デモ口座のみ。実際の銀行APIは未接続）。失敗は記録して画面・行動カードに表示 */
export async function syncBankAccount(db: DB, actor: Actor | null, accountId: string) {
  if (actor) manage(actor);
  const [a] = await db.select().from(bankAccount).where(eq(bankAccount.id, accountId)).limit(1);
  if (!a || a.archivedAt) throw notFound("口座が見つかりません");
  const provider = providerFor(a.provider);
  if (!provider) throw invalid("この口座は自動同期に対応していません。銀行サイトから取得した明細CSVを取り込んでください");
  const [run] = await db.insert(bankSyncRun).values({ accountId, kind: "SYNC" }).returning({ id: bankSyncRun.id });
  try {
    const since = a.lastSyncedAt ? addDays(todayJst(a.lastSyncedAt), -3) : addDays(todayJst(), -30);
    const res = await provider.fetch(a, since);
    return await db.transaction(async (tx) => {
      const r = await insertTxns(tx, accountId, res.transactions);
      await tx.update(bankAccount).set({ balance: res.balance, balanceAsOf: res.balanceAsOf, lastSyncedAt: new Date(), syncStatus: "OK", lastError: null }).where(eq(bankAccount.id, accountId));
      await tx.update(bankSyncRun).set({ status: "OK", finishedAt: new Date(), imported: r.imported, skipped: r.skipped }).where(eq(bankSyncRun.id, run.id));
      if (actor) await writeAudit(tx, actor, { action: "bank.sync", entityType: "bank_account", entityId: accountId, summary: `口座を同期（新規 ${r.imported}件・既存 ${r.skipped}件）` });
      return r;
    });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "同期エラー").slice(0, 200);
    await db.update(bankAccount).set({ syncStatus: "FAILED", lastError: msg }).where(eq(bankAccount.id, accountId));
    await db.update(bankSyncRun).set({ status: "FAILED", finishedAt: new Date(), error: msg }).where(eq(bankSyncRun.id, run.id));
    throw invalid(`同期に失敗しました: ${msg}（時間をおいて再試行するか、CSVを取り込んでください）`);
  }
}

/** 取込形式（このシステム独自の形式。銀行サイトのCSVの列を合わせて保存してください） */
export const BANK_CSV_HEADER = ["日付", "内容", "入金", "出金", "残高"];

/**
 * 明細CSVの取込。同じ行は何度取り込んでも1件（日付・金額・内容・残高と、同じ内容の行の出現順から取引IDを作る）
 * すべての行が正しい場合だけ取り込む
 */
export async function importBankCsv(db: DB, actor: Actor, accountId: string, fileName: string, text: string) {
  manage(actor);
  const [a] = await db.select().from(bankAccount).where(eq(bankAccount.id, accountId)).limit(1);
  if (!a || a.archivedAt) throw notFound("口座が見つかりません");
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (!rows.length) throw invalid("CSVが空です");
  const head = rows[0].map((h) => h.trim());
  const idx = BANK_CSV_HEADER.map((h) => head.indexOf(h));
  if (idx.slice(0, 4).some((i) => i < 0)) throw invalid(`見出し行に ${BANK_CSV_HEADER.slice(0, 4).join("・")} が必要です（残高は任意）`);
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const out: { externalId: string; txnDate: string; amount: number; description: string; balanceAfter: number | null }[] = [];
  const num = (s: string | undefined) => {
    const t = stripGuard((s ?? "").trim()).replace(/[,円\s]/g, "");
    if (t === "") return 0;
    if (!/^-?\d+$/.test(t)) return NaN;
    return Number(t);
  };
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = (r[idx[0]] ?? "").trim().replace(/\//g, "-").replace(/^(\d{4})-(\d)-/, "$1-0$2-").replace(/-(\d)$/, "-0$1");
    const desc = stripGuard((r[idx[1]] ?? "").trim()).slice(0, 200);
    const inAmt = num(r[idx[2]]);
    const outAmt = num(r[idx[3]]);
    const bal = idx[4] >= 0 ? num(r[idx[4]]) : 0;
    if (!DATE_RE.test(date)) return errors.push(`${line}行目: 日付が正しくありません`);
    if (Number.isNaN(inAmt) || Number.isNaN(outAmt) || Number.isNaN(bal)) return errors.push(`${line}行目: 金額は数字で入力してください`);
    if ((inAmt > 0) === (outAmt > 0)) return errors.push(`${line}行目: 入金か出金のどちらか一方を入力してください`);
    const amount = inAmt > 0 ? inAmt : -Math.abs(outAmt);
    const balanceAfter = idx[4] >= 0 && (r[idx[4]] ?? "").trim() !== "" ? bal : null;
    const base = `${date}|${amount}|${desc}|${balanceAfter ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ externalId: `csv-${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32)}`, txnDate: date, amount, description: desc || "（内容なし）", balanceAfter });
  });
  if (errors.length) throw invalid(`取り込めませんでした（${errors.length}件の誤り）\n${errors.slice(0, 20).join("\n")}`);
  return db.transaction(async (tx) => {
    const r = await insertTxns(tx, accountId, out);
    const last = [...out].sort((x, y) => x.txnDate.localeCompare(y.txnDate)).filter((x) => x.balanceAfter != null).pop();
    await tx.update(bankAccount).set({ ...(last ? { balance: last.balanceAfter, balanceAsOf: new Date(`${last.txnDate}T23:59:00+09:00`) } : {}), lastSyncedAt: new Date(), syncStatus: "OK", lastError: null }).where(eq(bankAccount.id, accountId));
    await tx.insert(bankSyncRun).values({ accountId, kind: "CSV", status: "OK", finishedAt: new Date(), imported: r.imported, skipped: r.skipped });
    await writeAudit(tx, actor, { action: "bank.csv_import", entityType: "bank_account", entityId: accountId, summary: `明細CSV「${fileName.slice(0, 80)}」を取込（新規 ${r.imported}件・既存 ${r.skipped}件）` });
    return r;
  });
}

/* ---------------- 取引・照合 ---------------- */

const ACTIVE_MATCH = sql`m.unmatched_at is null`;

export async function listTransactions(db: DB, actor: Actor, opts: { accountId?: string; view?: string; from?: string; to?: string } = {}) {
  view(actor);
  return db
    .select({
      t: bankTransaction,
      bankName: bankAccount.bankName,
      isDemo: bankAccount.isDemo,
      matched: sql<number>`(select coalesce(sum(m.amount), 0)::int from bank_match m where m.transaction_id = ${bankTransaction.id} and ${ACTIVE_MATCH})`,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.accountId))
    .where(
      and(
        opts.accountId ? eq(bankTransaction.accountId, opts.accountId) : undefined,
        opts.from ? gte(bankTransaction.txnDate, opts.from) : undefined,
        opts.to ? lte(bankTransaction.txnDate, opts.to) : undefined,
        opts.view === "unmatched" ? sql`${bankTransaction.classification} in ('UNCLASSIFIED','SALES_RECEIPT','EXPENSE_PAYMENT','STATEMENT_PAYMENT') and not exists (select 1 from bank_match m where m.transaction_id = ${bankTransaction.id} and ${ACTIVE_MATCH})` : undefined,
      ),
    )
    .orderBy(desc(bankTransaction.txnDate), desc(bankTransaction.importedAt))
    .limit(300);
}

async function lockTxn(tx: Tx, id: string) {
  const [t] = await tx.select().from(bankTransaction).where(eq(bankTransaction.id, id)).for("update");
  if (!t) throw notFound("取引が見つかりません");
  const [{ used }] = (await tx.execute<{ used: number }>(sql`select coalesce(sum(amount), 0)::int used from bank_match m where m.transaction_id = ${id} and ${ACTIVE_MATCH}`)).rows;
  return { t, remaining: Math.abs(t.amount) - used };
}

export async function getTransaction(db: DB, actor: Actor, id: string) {
  view(actor);
  const [r] = await db.select({ t: bankTransaction, a: bankAccount }).from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.accountId)).where(eq(bankTransaction.id, id)).limit(1);
  if (!r) throw notFound("取引が見つかりません");
  const matches = await db.execute<{ id: string; target_type: string; target_id: string; amount: number; matched_at: Date; unmatched_at: Date | null; label: string | null }>(sql`
    select m.id, m.target_type, m.target_id, m.amount, m.matched_at, m.unmatched_at,
      case when m.target_type = 'RECEIPT' then (select s.description || '（' || coalesce(p.name, '') || '）' from receipt r join sale s on s.id = r.sale_id left join partner p on p.id = s.customer_id where r.id = m.target_id)
           else (select y.payee_name || '：' || y.description from payable y where y.id = m.target_id) end label
    from bank_match m where m.transaction_id = ${id} order by m.matched_at desc`);
  const used = matches.rows.filter((m) => !m.unmatched_at).reduce((s, m) => s + m.amount, 0);
  return { ...r, matches: matches.rows, remaining: Math.abs(r.t.amount) - used };
}

/** 照合候補（金額が一致するものを優先。日付の近いもの） */
export async function matchCandidates(db: DB, actor: Actor, id: string) {
  view(actor);
  const x = await getTransaction(db, actor, id);
  const t = x.t;
  const amt = x.remaining;
  if (amt <= 0) return { receipts: [], sales: [], payables: [] };
  if (t.amount > 0) {
    const receipts = await db.execute<{ id: string; received_on: string; amount: number; description: string; customer: string | null }>(sql`
      select r.id, r.received_on, r.amount, s.description, p.name customer from receipt r join sale s on s.id = r.sale_id left join partner p on p.id = s.customer_id
      where r.canceled_at is null and r.amount <= ${amt}
        and not exists (select 1 from bank_match m where m.target_type = 'RECEIPT' and m.target_id = r.id and ${ACTIVE_MATCH})
        and r.received_on between ${addDays(t.txnDate, -10)} and ${addDays(t.txnDate, 10)}
      order by (r.amount = ${amt}) desc, abs(r.received_on - ${t.txnDate}::date) limit 20`);
    const sales = await db.execute<{ id: string; description: string; customer: string | null; month: string; rest: number; expected: string | null }>(sql`
      select * from (select s.id, s.description, p.name customer, s.month, s.expected_receipt_date expected,
        (s.amount_ex_tax + s.tax_amount - coalesce((select sum(r.amount) from receipt r where r.sale_id = s.id and r.canceled_at is null), 0))::int rest
        from sale s left join partner p on p.id = s.customer_id where s.canceled_at is null) z
      where rest > 0 order by (rest = ${amt}) desc, abs(coalesce(expected, ${t.txnDate}::date) - ${t.txnDate}::date) limit 20`);
    return { receipts: receipts.rows, sales: sales.rows, payables: [] };
  }
  const payables = await db.execute<{ id: string; payee_name: string; description: string; amount: number; due_date: string; status: string }>(sql`
    select y.id, y.payee_name, y.description, y.amount, y.due_date, y.status from payable y
    where y.status in ('SCHEDULED','PAID') and y.bank_transaction_id is null and y.amount <= ${amt}
      and not exists (select 1 from bank_match m where m.target_type = 'PAYABLE' and m.target_id = y.id and ${ACTIVE_MATCH})
    order by (y.amount = ${amt}) desc, abs(y.due_date - ${t.txnDate}::date) limit 20`);
  return { receipts: [], sales: [], payables: payables.rows };
}

/** 入金取引 → 既存の入金記録に照合 */
export async function matchReceipt(db: DB, actor: Actor, txnId: string, receiptId: string) {
  manage(actor);
  await db.transaction(async (tx) => {
    const { t, remaining } = await lockTxn(tx, txnId);
    if (t.amount <= 0) throw invalid("入金の取引ではありません");
    const [r] = await tx.select().from(receipt).where(eq(receipt.id, receiptId)).for("update");
    if (!r || r.canceledAt) throw notFound("入金記録が見つかりません");
    const [cur] = await tx.select().from(bankMatch).where(and(eq(bankMatch.targetType, "RECEIPT"), eq(bankMatch.targetId, receiptId), isNull(bankMatch.unmatchedAt))).limit(1);
    if (cur) {
      if (cur.transactionId === txnId) return; // 既に同じ取引と照合済み（繰り返し操作）
      throw conflict("この入金記録は既に別の取引と照合されています");
    }
    if (r.amount > remaining) throw invalid("取引の未照合額を超えています");
    await tx.insert(bankMatch).values({ transactionId: txnId, targetType: "RECEIPT", targetId: receiptId, amount: r.amount, matchedById: actor.userId });
    await tx.update(receipt).set({ bankTransactionId: txnId }).where(eq(receipt.id, receiptId));
    if (t.classification === "UNCLASSIFIED") await tx.update(bankTransaction).set({ classification: "SALES_RECEIPT" }).where(eq(bankTransaction.id, txnId));
    await writeAudit(tx, actor, { action: "bank.match", entityType: "bank_transaction", entityId: txnId, summary: `入金取引（${t.txnDate} ${t.amount}円）を入金記録に照合` });
  }).catch(rethrowMatchConflict);
}

/** 入金取引 → 売上に入金を登録して照合（同じ操作を繰り返しても入金は1件） */
export async function receiveFromTxn(db: DB, actor: Actor, txnId: string, saleId: string, amount?: number) {
  manage(actor);
  const [t] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, txnId)).limit(1);
  if (!t || t.amount <= 0) throw invalid("入金の取引ではありません");
  const x = await getTransaction(db, actor, txnId);
  const apply = amount ?? x.remaining;
  if (apply <= 0 || apply > x.remaining) throw invalid("照合する金額が正しくありません");
  const r = await addReceipt(db, actor, { saleId, receivedOn: t.txnDate, amount: String(apply), note: `銀行取引から登録（${t.description.slice(0, 40)}）`, idempotencyKey: `bank:${txnId}:${saleId}` }, { bankTransactionId: txnId });
  const [already] = await db.select({ id: bankMatch.id }).from(bankMatch).where(and(eq(bankMatch.targetType, "RECEIPT"), eq(bankMatch.targetId, r.id), isNull(bankMatch.unmatchedAt))).limit(1);
  if (!already) {
    try {
      await matchReceipt(db, actor, txnId, r.id);
    } catch (e) {
      // 同時に同じ操作が行われた場合は、もう一方の照合が有効（入金も照合も1件）
      if (!(e instanceof Error && e.message === "既に照合済みです")) throw e;
    }
  }
  return r;
}

/** 出金取引 → 支払予定に照合（支払予定は「支払済み」になる） */
export async function matchPayable(db: DB, actor: Actor, txnId: string, payableId: string) {
  manage(actor);
  await db.transaction(async (tx) => {
    const { t, remaining } = await lockTxn(tx, txnId);
    if (t.amount >= 0) throw invalid("出金の取引ではありません");
    const [p] = await tx.select().from(payable).where(eq(payable.id, payableId)).for("update");
    if (!p || p.status === "CANCELED") throw notFound("支払予定が見つかりません");
    if (p.bankTransactionId) throw conflict("この支払予定は既に別の取引と照合されています");
    if (p.amount > remaining) throw invalid("取引の未照合額を超えています");
    await tx.insert(bankMatch).values({ transactionId: txnId, targetType: "PAYABLE", targetId: payableId, amount: p.amount, matchedById: actor.userId });
    await tx.update(payable).set({ status: "PAID", paidOn: p.paidOn ?? t.txnDate, bankTransactionId: txnId }).where(eq(payable.id, payableId));
    if (t.classification === "UNCLASSIFIED") await tx.update(bankTransaction).set({ classification: p.source === "STATEMENT" ? "STATEMENT_PAYMENT" : "EXPENSE_PAYMENT" }).where(eq(bankTransaction.id, txnId));
    await writeAudit(tx, actor, { action: "bank.match", entityType: "bank_transaction", entityId: txnId, summary: `出金取引（${t.txnDate} ${t.amount}円）を支払予定「${p.payeeName}」に照合（支払済み）` });
  }).catch(rethrowMatchConflict);
}

function rethrowMatchConflict(e: unknown): never {
  const s = JSON.stringify((e as { cause?: unknown })?.cause ?? e) + String(e);
  if (s.includes("bank_match_target_uq")) throw conflict("既に照合済みです");
  throw e;
}

/** 照合の解除（記録は残す）。支払予定は未払いに戻し、取引から作った入金記録は取消す */
export async function unmatch(db: DB, actor: Actor, matchId: string, reason: string) {
  manage(actor);
  const why = parse(zText("解除の理由", 300), reason);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(bankMatch).where(eq(bankMatch.id, matchId)).for("update");
    if (!m || m.unmatchedAt) throw notFound("照合が見つかりません");
    if (m.targetType === "PAYABLE") {
      await tx.update(payable).set({ status: "SCHEDULED", paidOn: null, bankTransactionId: null }).where(and(eq(payable.id, m.targetId), eq(payable.bankTransactionId, m.transactionId)));
    } else {
      const [r] = await tx.select().from(receipt).where(eq(receipt.id, m.targetId)).for("update");
      if (r && r.idempotencyKey.startsWith("bank:") && !r.canceledAt) {
        await assertMonthOpen(tx, r.receivedOn.slice(0, 7), "入金");
        await tx.update(receipt).set({ canceledAt: new Date(), cancelReason: `銀行照合の解除: ${why}`, bankTransactionId: null }).where(eq(receipt.id, r.id));
      } else if (r) await tx.update(receipt).set({ bankTransactionId: null }).where(eq(receipt.id, r.id));
    }
    await tx.update(bankMatch).set({ unmatchedAt: new Date() }).where(eq(bankMatch.id, matchId));
    await writeAudit(tx, actor, { action: "bank.unmatch", entityType: "bank_transaction", entityId: m.transactionId, summary: `照合を解除: ${why}` });
  });
}

export async function classifyTransaction(db: DB, actor: Actor, id: string, classification: string, note: string) {
  manage(actor);
  const c = parse(z.enum(["UNCLASSIFIED", "SALES_RECEIPT", "EXPENSE_PAYMENT", "STATEMENT_PAYMENT", "TRANSFER", "LOAN", "TAX", "OTHER"]), classification);
  await db.transaction(async (tx) => {
    const [t] = await tx.update(bankTransaction).set({ classification: c, note: note.trim().slice(0, 300) || null }).where(eq(bankTransaction.id, id)).returning();
    if (!t) throw notFound();
    await writeAudit(tx, actor, { action: "bank.classify", entityType: "bank_transaction", entityId: id, summary: `取引（${t.txnDate} ${t.amount}円）の区分を ${c} に設定` });
  });
}

export async function listSyncRuns(db: DB, actor: Actor) {
  view(actor);
  return db.select({ r: bankSyncRun, bankName: bankAccount.bankName }).from(bankSyncRun).leftJoin(bankAccount, eq(bankAccount.id, bankSyncRun.accountId)).orderBy(desc(bankSyncRun.startedAt)).limit(30);
}

/** 定期処理: 自動同期できる口座を同期（失敗は記録のみ） */
export async function syncAllAccounts(db: DB) {
  const rows = await db.select().from(bankAccount).where(and(isNull(bankAccount.archivedAt), sql`${bankAccount.provider} <> 'CSV'`));
  let ok = 0, failed = 0;
  for (const a of rows) {
    try {
      await syncBankAccount(db, null, a.id);
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}
