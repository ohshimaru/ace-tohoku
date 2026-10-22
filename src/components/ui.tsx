import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ---------- レイアウト ---------- */

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm text-navy-600 hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-xl font-bold text-navy-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-bold text-navy-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4" }[cols];
  return <div className={cx("grid grid-cols-1 gap-4", c)}>{children}</div>;
}

/* ---------- ボタン・リンク ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost";
const btn: Record<Variant, string> = {
  primary: "bg-navy-700 text-white hover:bg-navy-800 disabled:bg-navy-300",
  secondary: "border border-line bg-white text-navy-800 hover:bg-navy-50 disabled:text-navy-300",
  danger: "border border-bad/30 bg-white text-bad hover:bg-bad-bg disabled:opacity-50",
  ghost: "text-navy-700 hover:bg-navy-50",
};
const btnBase = "inline-flex min-h-10 items-center justify-center gap-1 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed";

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...p} className={cx(btnBase, btn[variant], className)} />;
}

export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={cx(btnBase, btn[variant], className)} />;
}

/* ---------- フォーム ---------- */

export function Field({ label, children, hint, required, className }: { label: string; children: ReactNode; hint?: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-bold text-navy-800">
        {label}
        {required && <span className="ml-1 text-bad">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputCls =
  "block w-full min-h-10 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-navy-300 focus:border-navy-500 disabled:bg-navy-50";

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cx(inputCls, p.className)} />;
}
export function Select(p: ComponentProps<"select">) {
  return <select {...p} className={cx(inputCls, p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea rows={3} {...p} className={cx(inputCls, p.className)} />;
}

/* ---------- 表示 ---------- */

type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "navy";
const tones: Record<Tone, string> = {
  neutral: "bg-navy-50 text-navy-700 border-navy-100",
  ok: "bg-ok-bg text-ok border-ok/20",
  warn: "bg-warn-bg text-warn border-warn/20",
  bad: "bg-bad-bg text-bad border-bad/20",
  info: "bg-info-bg text-info border-info/20",
  navy: "bg-navy-700 text-white border-navy-700",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Notice({ tone = "info", title, children }: { tone?: Exclude<Tone, "navy" | "neutral">; title?: string; children: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-md border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-bold">{title}</p>}
      <div className={cx("whitespace-pre-line [overflow-wrap:anywhere]", title && "mt-1")}>{children}</div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap border-b border-line bg-navy-50 px-3 py-2.5 text-left text-[0.8rem] font-bold text-navy-800", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx("border-b border-line px-3 py-2.5 align-top", className)}>
      {children}
    </td>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-navy-200 bg-navy-50/50 px-4 py-10 text-center">
      <p className="font-bold text-navy-800">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-bold text-navy-800">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, total, limit, params }: { page: number; total: number; limit: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">全 {total} 件</p>;
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `?${sp.toString()}`;
  };
  return (
    <nav className="mt-3 flex items-center justify-between text-sm" aria-label="ページ送り">
      <span className="text-muted">
        全 {total} 件（{page} / {pages} ページ）
      </span>
      <span className="flex gap-2">
        {page > 1 ? <LinkButton href={href(page - 1)}>前へ</LinkButton> : <Button variant="secondary" disabled>前へ</Button>}
        {page < pages ? <LinkButton href={href(page + 1)}>次へ</LinkButton> : <Button variant="secondary" disabled>次へ</Button>}
      </span>
    </nav>
  );
}

/** 一覧上部の検索・絞り込みフォーム（GETで送信） */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
      {children}
      <Button type="submit" variant="secondary">
        絞り込む
      </Button>
    </form>
  );
}
