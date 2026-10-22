import "server-only";
/**
 * 銀行データの取得アダプター
 * - DEMO: 架空の取引を作る（画面・照合の動作確認用。必ず「デモ」と表示）
 * - CSV : 利用者が銀行サイトから取得した明細CSVを取り込む（bank.ts の importBankCsv）
 * - 実際の銀行API・口座情報サービスとの接続は未実装。接続には各サービスとの契約と、
 *   OAuth 等の正式な認可方式が必要です。銀行のログイン情報（ID・パスワード）は保存しません。
 *   追加する場合は BankProvider を実装して PROVIDERS に登録します。
 */
import { createHash } from "node:crypto";
import { addDays, todayJst } from "@/lib/dates";

export type FetchedTxn = { externalId: string; txnDate: string; amount: number; description: string; balanceAfter: number | null };
export type FetchResult = { transactions: FetchedTxn[]; balance: number | null; balanceAsOf: Date };

export interface BankProvider {
  key: string;
  label: string;
  live: boolean;
  fetch(account: { id: string; providerAccountRef: string | null; balance: number | null }, since: string): Promise<FetchResult>;
}

/** 決まった値を返すデモ（同じ日付なら同じ取引ID → 再同期しても重複しない） */
const demo: BankProvider = {
  key: "DEMO",
  label: "デモ（架空データ）",
  live: false,
  async fetch(account, since) {
    const today = todayJst();
    const txns: FetchedTxn[] = [];
    let bal = account.balance ?? 3_000_000;
    const seed = (s: string) => parseInt(createHash("sha256").update(`${account.id}:${s}`).digest("hex").slice(0, 8), 16);
    for (let d = since > addDays(today, -30) ? since : addDays(today, -30); d <= today; d = addDays(d, 1)) {
      const n = seed(d);
      if (n % 3 !== 0) continue;
      const incoming = n % 2 === 0;
      const amount = (incoming ? 1 : -1) * (Math.floor((n % 400) / 10) * 5_000 + 11_000);
      bal += amount;
      txns.push({ externalId: `demo-${d}-${n % 1000}`, txnDate: d, amount, description: incoming ? `デモ入金 カ）デモトリヒキサキ${n % 7}` : `デモ出金 デモシハライサキ${n % 5}`, balanceAfter: bal });
    }
    return { transactions: txns, balance: bal, balanceAsOf: new Date() };
  },
};

export const PROVIDERS: Record<string, BankProvider> = { DEMO: demo };

export function providerFor(key: string): BankProvider | null {
  return PROVIDERS[key] ?? null;
}
