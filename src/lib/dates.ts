/** 日付ユーティリティ（業務日は Asia/Tokyo 基準の 'YYYY-MM-DD' 文字列） */

const TZ = "Asia/Tokyo";
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hmFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dtFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-\d{2}$/;

/** Date を JST の 'YYYY-MM-DD' に */
export function toJstDate(d: Date): string {
  return ymdFmt.format(d);
}

export function todayJst(now: Date = new Date()): string {
  return toJstDate(now);
}

export function currentMonthJst(now: Date = new Date()): string {
  return todayJst(now).slice(0, 7);
}

/** 'YYYY-MM-DD' と 'HH:mm' を JST として解釈 */
export function jstDateTime(date: string, time: string): Date {
  if (!DATE_RE.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("日時の形式が不正です");
  const d = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(d.getTime())) throw new Error("日時が不正です");
  return d;
}

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' → [初日, 末日] */
export function monthRange(ym: string): [string, string] {
  if (!MONTH_RE.test(ym)) throw new Error("年月の形式が不正です");
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** 開始月〜終了月（両端含む）の 'YYYY-MM' 配列 */
export function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  let cur = fromYm;
  for (let i = 0; cur <= toYm && i < 600; i++) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${y}/${m}/${d}`;
}

export function formatTime(d: Date | null | undefined): string {
  return d ? hmFmt.format(d) : "—";
}

export function formatDateTime(d: Date | null | undefined): string {
  return d ? dtFmt.format(d) : "—";
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** 会計年度（開始月の年を年度とする。例: 4月始まりで 2027-02 → 2026年度） */
export function fiscalYearOf(ym: string, startMonth: number): number {
  const [y, m] = ym.split("-").map(Number);
  return m >= startMonth ? y : y - 1;
}

export function fiscalYearRange(fy: number, startMonth: number): [string, string] {
  const from = `${fy}-${String(startMonth).padStart(2, "0")}`;
  return [from, addMonths(from, 11)];
}

export function monthOf(date: string) {
  return date.slice(0, 7);
}
