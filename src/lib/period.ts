import { addMonths, currentMonthJst, MONTH_RE } from "@/lib/dates";

/** URL の from/to（YYYY-MM）を正規化。既定は当月 */
export function periodFromParams(sp: { from?: string; to?: string; division?: string }) {
  const cur = currentMonthJst();
  let from = sp.from && MONTH_RE.test(sp.from) ? sp.from : cur;
  let to = sp.to && MONTH_RE.test(sp.to) ? sp.to : from;
  if (from > to) [from, to] = [to, from];
  if (to > addMonths(from, 35)) to = addMonths(from, 35);
  const divisionId = sp.division && /^[0-9a-f-]{36}$/i.test(sp.division) ? sp.division : undefined;
  return { from, to, divisionId };
}

export function periodLabel(from: string, to: string) {
  return from === to ? `${from.replace("-", "年")}月` : `${from.replace("-", "年")}月〜${to.replace("-", "年")}月`;
}

export function qs(o: Record<string, string | undefined>) {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
}
