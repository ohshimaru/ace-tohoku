"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export type NavItem = { href: string; label: string; icon: string; badge?: number };

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((it) => {
        const active = it.href === "/app" ? path === "/app" : path === it.href || path.startsWith(`${it.href}/`);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm",
                active ? "bg-navy-700 font-bold text-white" : "text-navy-100 hover:bg-navy-800 hover:text-white",
              )}
            >
              <span aria-hidden className="w-5 text-center">
                {it.icon}
              </span>
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className="rounded-full bg-amber-400 px-2 text-xs font-bold text-navy-950">{it.badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

