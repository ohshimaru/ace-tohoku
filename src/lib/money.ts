/**
 * 金額計算（すべて円単位の整数で扱う）
 *
 * - 明細金額: round_half_up(数量 × 単価)。数量は小数第2位まで。
 * - 消費税: 税率ごとに明細の税抜合計へ1回だけ計算し、1円未満切り捨て。
 * - 経費の税抜額: 税込 − floor(税込 × 税率 ÷ (100 + 税率))
 */

export const TAX_RATES = [10, 8, 0] as const;
export type TaxRate = (typeof TAX_RATES)[number];

export function isTaxRate(n: number): n is TaxRate {
  return (TAX_RATES as readonly number[]).includes(n);
}

const yen = new Intl.NumberFormat("ja-JP");
export function formatYen(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `¥${yen.format(n)}`;
}

/** 数量文字列（例 "1.5"）を 100 倍の整数に。小数第3位以下は不可 */
export function parseQuantity100(q: string): number {
  const s = q.trim();
  if (!/^-?\d{1,8}(\.\d{1,2})?$/.test(s)) throw new Error("数量は小数第2位までの数値で入力してください");
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const v = Number(i) * 100 + Number(f.padEnd(2, "0"));
  return neg ? -v : v;
}

/** 0から離れる方向への四捨五入で、整数 a / b を丸める（b > 0） */
export function divRoundHalfUp(a: number, b: number): number {
  if (b <= 0) throw new Error("divisor must be positive");
  const sign = a < 0 ? -1 : 1;
  const abs = Math.abs(a);
  return sign * Math.floor((abs * 2 + b) / (2 * b));
}

export function lineAmount(quantity: string, unitPrice: number): number {
  assertSafeInt(unitPrice);
  const q100 = parseQuantity100(quantity);
  const product = q100 * unitPrice;
  assertSafeInt(product);
  return divRoundHalfUp(product, 100);
}

export type TaxLine = { amount: number; taxRate: number };

export function computeInvoiceTotals(lines: TaxLine[]) {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    if (!isTaxRate(l.taxRate)) throw new Error("税率が不正です");
    byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + l.amount);
  }
  const breakdown = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base, tax: base > 0 ? Math.floor((base * rate) / 100) : 0 }));
  const subtotal = breakdown.reduce((s, r) => s + r.base, 0);
  const taxTotal = breakdown.reduce((s, r) => s + r.tax, 0);
  return { breakdown, subtotal, taxTotal, total: subtotal + taxTotal };
}

/** 経費の税込金額から税抜金額を求める */
export function expenseNetAmount(amountInclTax: number, taxRate: number): number {
  if (!isTaxRate(taxRate)) throw new Error("税率が不正です");
  const tax = Math.floor((amountInclTax * taxRate) / (100 + taxRate));
  return amountInclTax - tax;
}

/** 工数1件の人件費（分 × 時間単価 ÷ 60 を四捨五入） */
export function laborCost(minutes: number, hourlyCost: number): number {
  return divRoundHalfUp(minutes * hourlyCost, 60);
}

/** フォーム入力の金額（カンマ・円記号可）を整数に */
export function parseYen(input: string | null | undefined, { allowNegative = false } = {}): number {
  const s = String(input ?? "")
    .replace(/[,，¥￥\s円]/g, "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!(allowNegative ? /^-?\d+$/ : /^\d+$/).test(s)) throw new Error("金額は整数で入力してください");
  const n = Number(s);
  assertSafeInt(n);
  if (Math.abs(n) > 10_000_000_000) throw new Error("金額が大きすぎます");
  return n;
}

function assertSafeInt(n: number) {
  if (!Number.isSafeInteger(n)) throw new Error("金額が計算可能な範囲を超えています");
}

export type Rounding = "FLOOR" | "ROUND" | "CEIL";

/** 端数処理（正の値を想定。負の値は絶対値で処理して符号を戻す） */
export function roundYen(numerator: number, denominator: number, mode: Rounding): number {
  if (denominator <= 0) throw new Error("denominator must be positive");
  const sign = numerator < 0 ? -1 : 1;
  const a = Math.abs(numerator);
  const q = Math.floor(a / denominator);
  const r = a - q * denominator;
  let v = q;
  if (mode === "CEIL" && r > 0) v = q + 1;
  if (mode === "ROUND" && r * 2 >= denominator) v = q + 1;
  return sign * v;
}

/** 税抜金額から消費税 */
export function taxFromNet(net: number, rate: number, mode: Rounding = "FLOOR") {
  if (!isTaxRate(rate)) throw new Error("税率が不正です");
  return roundYen(net * rate, 100, mode);
}

/** 税込金額に含まれる消費税 */
export function taxFromGross(gross: number, rate: number, mode: Rounding = "FLOOR") {
  if (!isTaxRate(rate)) throw new Error("税率が不正です");
  return roundYen(gross * rate, 100 + rate, mode);
}

/** 万分率（10000=100%）を掛ける */
export function applyBp(amount: number, bp: number, mode: Rounding = "FLOOR") {
  return roundYen(amount * bp, 10000, mode);
}

/** 合計を割合で配分（端数は最大剰余法で合計が一致するように） */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map((x) => Math.trunc(x));
  let rest = total - base.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => [Math.abs(x - Math.trunc(x)), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest !== 0 && k < order.length; k++) {
    base[order[k][1]] += Math.sign(rest);
    rest -= Math.sign(rest);
  }
  return base;
}
