import Link from "next/link";
import { Suspense } from "react";
import { Flash } from "@/components/flash";
import { requireProvider } from "@/lib/session";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

/** サービス提供者画面（担当会社の入出金を管理し、本社・スタッフへの公開範囲を決める） */
export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireProvider();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-navy-950 px-4 py-2 text-white">
        <Link href="/p" className="block">
          <span className="block text-[11px] text-navy-300">サービス提供者画面</span>
          <span className="block font-bold">入出金の管理と公開設定</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span>{actor.name}{actor.demo && <span className="ml-2 rounded bg-warn-bg px-2 py-0.5 text-xs font-bold text-warn">デモログイン</span>}</span>
          <form action={logoutAction}><button type="submit" className="min-h-9 rounded-md border border-navy-600 px-3 text-xs hover:bg-navy-800">ログアウト</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-16 sm:px-6">
        <Suspense fallback={null}><Flash /></Suspense>
        {children}
      </main>
    </div>
  );
}
