import Link from "next/link";
import { formatYen } from "@/lib/money";
import { cx } from "./ui";

export function Metric({ label, value, href, note, tone, unit }: { label: string; value: number | null | string; href?: string; note?: React.ReactNode; tone?: "bad" | "ok" | "warn"; unit?: "yen" | "pct" | "count" }) {
  const v = value === null ? "—" : typeof value === "string" ? value : unit === "pct" ? `${Math.round(value * 1000) / 10}%` : unit === "count" ? `${value.toLocaleString()}件` : formatYen(value);
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : typeof value === "number" && value < 0 && unit !== "count" ? "text-bad" : "text-navy-900";
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={cx("tabular mt-1 truncate text-xl font-bold sm:text-2xl", color)}>{href ? <Link className="hover:underline" href={href}>{v}</Link> : v}</p>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

export function Bar({ value, max, tone = "navy" }: { value: number; max: number; tone?: "navy" | "bad" | "warn" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bg = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-navy-600";
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-navy-100" role="img" aria-label={`${Math.round(pct)}%`}>
      <div className={cx("h-full rounded", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}
