"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const TABS = [
  { href: "/d", label: "ホーム", icon: "⌂" },
  { href: "/d/availability", label: "稼働希望", icon: "☐" },
  { href: "/d/schedule", label: "予定", icon: "▦" },
  { href: "/d/reports", label: "日報", icon: "✐" },
  { href: "/d/more", label: "その他", icon: "≡" },
];
const MORE = ["/d/more", "/d/expenses", "/d/statements", "/d/profile", "/d/contracts", "/d/finance"];

export function DriverTabs() {
  const path = usePathname();
  return (
    <nav aria-label="メニュー" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {TABS.map((t) => {
          const active = t.href === "/d" ? path === "/d" : t.href === "/d/more" ? MORE.some((m) => path.startsWith(m)) : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={cx("flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs", active ? "font-bold text-navy-800" : "text-muted")}>
                <span aria-hidden className={cx("text-xl leading-none", active && "rounded-full bg-navy-100 px-3")}>{t.icon}</span>
                {t.label}
                {active && <span className="sr-only">（表示中）</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
