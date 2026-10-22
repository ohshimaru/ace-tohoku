import Link from "next/link";
import { Suspense } from "react";
import { Flash } from "@/components/flash";
import { MobileMenu } from "@/components/mobile-menu";
import { NavLinks, type NavItem } from "@/components/nav";
import { getDb } from "@/db";
import { type Actor, can, isCompanyWide, ROLE_LABELS } from "@/lib/access";
import { requireStaff } from "@/lib/session";
import { getSettings } from "@/server/masters";
import { getWorkQueue } from "@/server/metrics";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

function items(a: Actor, q: Awaited<ReturnType<typeof getWorkQueue>>): { group: string; items: NavItem[] }[] {
  const g = (group: string, list: (NavItem | false)[]) => ({ group, items: list.filter((x): x is NavItem => !!x) });
  return [
    g("経営", [
      { href: "/app/guide", label: "使い方", icon: "?" },
      { href: "/app", label: "ダッシュボード", icon: "▦" },
      { href: "/app/tasks", label: "タスク", icon: "✔", badge: q.open_tasks },
      { href: "/app/actions", label: "AIの指摘（詳細）", icon: "✦" },
      { href: "/app/divisions", label: "事業部", icon: "◫" },
      { href: "/app/pl", label: "損益・予実", icon: "≋" },
      { href: "/app/budget", label: "予算", icon: "◔" },
    ]),
    g("お金", [
      { href: "/app/sales", label: "売上・入金", icon: "↗" },
      { href: "/app/expenses", label: "経費", icon: "↘" },
      { href: "/app/approvals", label: "承認", icon: "✓", badge: q.pending_expenses + q.pending_reports + q.pending_budget_requests },
      isCompanyWide(a) && { href: "/app/payables", label: "支払予定", icon: "⇥" },
      can.viewBank(a) && { href: "/app/bank", label: "銀行口座", icon: "⌂" },
      can.closeMonth(a) && { href: "/app/months", label: "月次締め", icon: "▣" },
    ]),
    g("取引", [
      { href: "/app/partners", label: "顧客・取引先", icon: "◎" },
      { href: "/app/projects", label: "案件", icon: "▤" },
      { href: "/app/contracts", label: "契約書", icon: "✎" },
    ]),
    g("業務委託", [
      { href: "/app/drivers", label: "ドライバー", icon: "☺" },
      { href: "/app/shifts", label: "稼働スケジュール", icon: "▦" },
      { href: "/app/reports", label: "日報", icon: "✐", badge: q.pending_reports },
      { href: "/app/statements", label: "稼働明細", icon: "≡", badge: q.draft_statements },
      { href: "/app/reminders", label: "メール送信", icon: "✉" },
    ]),
    g("連携・設定", [
      { href: "/app/cleanup", label: "Clean Up連携", icon: "⇄" },
      can.administer(a) && { href: "/app/settings", label: "設定", icon: "⚙" },
      can.administer(a) && { href: "/app/audit", label: "監査ログ", icon: "☰" },
    ]),
  ].filter((x) => x.items.length);
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaff();
  const db = getDb();
  const [s, q] = await Promise.all([getSettings(db), getWorkQueue(db, actor)]);
  const groups = items(actor, q);
  const nav = (
    <nav aria-label="メインメニュー" className="space-y-4">
      {groups.map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-3 text-[11px] font-bold tracking-widest text-navy-400">{g.group}</p>
          <NavLinks items={g.items} />
        </div>
      ))}
    </nav>
  );
  const brand = (
    <Link href="/app" className="block px-3 py-2">
      <span className="block text-xs text-navy-300">{s.companyName}</span>
      <span className="block text-lg font-bold tracking-wide text-white">{s.appName}</span>
    </Link>
  );
  const user = (
    <div className="mt-6 border-t border-navy-700 px-3 pt-4 text-sm text-navy-100">
      <p className="font-bold text-white">{actor.name}</p>
      <p className="text-xs text-navy-300">{ROLE_LABELS[actor.role]}{actor.demo && "（デモログイン）"}</p>
      <form action={logoutAction} className="mt-3">
        <button type="submit" className="min-h-9 rounded-md border border-navy-600 px-3 text-xs hover:bg-navy-800">ログアウト</button>
      </form>
    </div>
  );
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 bg-navy-900 p-3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto">
        {brand}
        <div className="mt-4 flex-1">{nav}</div>
        {user}
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between bg-navy-900 px-2 py-1 lg:hidden">
        <MobileMenu title="メインメニュー">
          {brand}
          <div className="mt-4">{nav}</div>
          {user}
        </MobileMenu>
        <span className="text-sm font-bold text-white">{s.appName}</span>
        <span className="w-10" />
      </header>
      <div className="min-w-0 flex-1">
        {(s.demoDataLoadedAt || actor.demo) && (
          <div className="border-b border-warn/30 bg-warn-bg px-4 py-2 text-center text-xs font-bold text-warn" role="status">
            {s.demoDataLoadedAt ? "デモデータ（架空）が入っています。実際の取引ではありません。" : ""}
            {actor.demo ? " デモログイン中（デモ用アカウント）。" : ""}
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 pb-16 sm:px-6">
          <Suspense fallback={null}>
            <Flash />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}
