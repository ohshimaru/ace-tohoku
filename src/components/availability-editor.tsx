"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action";
import { Button, cx, Notice } from "./ui";

type Kind = "AVAILABLE" | "UNAVAILABLE" | "TIME" | "";
type Day = { kind: Kind; start: string; end: string };
type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const OPTS: { k: Kind; label: string; cls: string }[] = [
  { k: "AVAILABLE", label: "○ 可能", cls: "border-ok bg-ok-bg text-ok" },
  { k: "TIME", label: "◐ 時間", cls: "border-info bg-info-bg text-info" },
  { k: "UNAVAILABLE", label: "× 不可", cls: "border-bad bg-bad-bg text-bad" },
];

/** 稼働希望の入力（1か月分・まとめて入力できる）。状態は記号と文字でも表示（色だけに頼らない） */
export function AvailabilityEditor({ month, dates, initial, action }: { month: string; dates: string[]; initial: Record<string, Day>; action: Action }) {
  const [days, setDays] = useState<Record<string, Day>>(initial);
  const [state, formAction] = useActionState(action, { ok: false, message: "", at: 0 });
  const [bulkStart, setBulkStart] = useState("09:00");
  const [bulkEnd, setBulkEnd] = useState("18:00");
  const set = (d: string, v: Partial<Day>) => setDays((p) => ({ ...p, [d]: { ...{ kind: "" as Kind, start: bulkStart, end: bulkEnd }, ...p[d], ...v } }));
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const bulk = (pred: (d: string) => boolean, kind: Kind) => setDays((p) => {
    const n = { ...p };
    for (const d of dates) if (pred(d)) n[d] = { kind, start: bulkStart, end: bulkEnd };
    return n;
  });
  const payload = useMemo(() => JSON.stringify(dates.map((d) => ({ date: d, kind: days[d]?.kind ?? "", start: days[d]?.start, end: days[d]?.end }))), [dates, days]);
  const count = (k: Kind) => dates.filter((d) => (days[d]?.kind ?? "") === k).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="days" value={payload} />
      <details className="rounded-lg border border-line bg-white p-3" open>
        <summary className="cursor-pointer font-bold text-navy-900">まとめて入力</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => bulk((d) => dow(d) >= 1 && dow(d) <= 5, "AVAILABLE")}>平日を「可能」</Button>
          <Button type="button" variant="secondary" onClick={() => bulk((d) => dow(d) === 0 || dow(d) === 6, "UNAVAILABLE")}>土日を「不可」</Button>
          <Button type="button" variant="secondary" onClick={() => bulk(() => true, "AVAILABLE")}>全日「可能」</Button>
          <Button type="button" variant="secondary" onClick={() => bulk((d) => !days[d]?.kind, "UNAVAILABLE")}>未入力を「不可」</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">時間指定の開始<input type="time" value={bulkStart} onChange={(e) => setBulkStart(e.target.value)} className="rounded-md border border-line px-2" /></label>
          <label className="grid gap-1">終了<input type="time" value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} className="rounded-md border border-line px-2" /></label>
          <Button type="button" variant="secondary" onClick={() => bulk((d) => dow(d) >= 1 && dow(d) <= 5, "TIME")}>平日をこの時間で</Button>
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => setDays({})}>すべて消す</Button>
      </details>

      <p className="text-sm text-muted" aria-live="polite">○ 可能 {count("AVAILABLE")}日 ／ ◐ 時間指定 {count("TIME")}日 ／ × 不可 {count("UNAVAILABLE")}日 ／ 未入力 {count("")}日</p>

      <ul className="space-y-2">
        {dates.map((d) => {
          const v = days[d] ?? { kind: "", start: bulkStart, end: bulkEnd };
          const w = dow(d);
          return (
            <li key={d} className="rounded-lg border border-line bg-white p-3">
              <p className={cx("mb-2 font-bold", w === 0 && "text-bad", w === 6 && "text-info")}>{Number(d.slice(5, 7))}/{Number(d.slice(8))}（{WD[w]}）{!v.kind && <span className="ml-2 text-xs font-normal text-muted">未入力</span>}</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={`${d} の稼働希望`}>
                {OPTS.map((o) => (
                  <button key={o.k} type="button" role="radio" aria-checked={v.kind === o.k} onClick={() => set(d, { kind: v.kind === o.k ? "" : o.k })} className={cx("min-h-12 rounded-md border-2 text-base font-bold", v.kind === o.k ? o.cls : "border-line bg-white text-muted")}>
                    {o.label}
                  </button>
                ))}
              </div>
              {v.kind === "TIME" && (
                <div className="mt-2 flex items-center gap-2">
                  <input aria-label="開始" type="time" value={v.start} onChange={(e) => set(d, { start: e.target.value })} className="min-h-12 flex-1 rounded-md border border-line px-2" />
                  〜
                  <input aria-label="終了" type="time" value={v.end} onChange={(e) => set(d, { end: e.target.value })} className="min-h-12 flex-1 rounded-md border border-line px-2" />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {state.at > 0 && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
      <div className="sticky bottom-20 z-10 grid grid-cols-2 gap-2 rounded-lg border border-line bg-white/95 p-2 shadow-lg">
        <Submit name="submit" value="0" label="下書き保存" variant="secondary" />
        <Submit name="submit" value="1" label="提出する" variant="primary" confirm={count("") > 0 ? `未入力の日が${count("")}日あります。未入力の日は割当されません。提出しますか？` : "提出しますか？提出後の変更は変更申請になります。"} />
      </div>
    </form>
  );
}

function Submit({ name, value, label, variant, confirm }: { name: string; value: string; label: string; variant: "primary" | "secondary"; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} variant={variant} disabled={pending} className="min-h-12 text-base" onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending ? "処理中…" : label}
    </Button>
  );
}
