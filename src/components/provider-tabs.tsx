"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function ProviderTabs({ cid }: { cid: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/p/${cid}`, label: "入出金と公開状況" },
    { href: `/p/${cid}/accounts`, label: "口座・取込・手動登録" },
    { href: `/p/${cid}/disclosure`, label: "公開権限（残高・集計・出力）" },
    { href: `/p/${cid}/preview`, label: "見え方の確認" },
    { href: `/p/${cid}/audit`, label: "操作履歴" },
  ];
  return (
    <nav aria-label="会社のメニュー" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = t.href === `/p/${cid}` ? path === t.href || path.startsWith(`/p/${cid}/t/`) : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-navy-700 font-bold text-navy-900" : "border-transparent text-muted hover:text-navy-800")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
