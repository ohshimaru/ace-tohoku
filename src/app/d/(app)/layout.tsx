import { Suspense } from "react";
import { Flash } from "@/components/flash";
import { DriverTabs } from "@/components/driver-tabs";
import { getDb } from "@/db";
import { requireDriver } from "@/lib/session";
import { getSettings } from "@/server/masters";

export const dynamic = "force-dynamic";

/** ドライバー画面（スマホ優先・大きなボタン・下部タブ） */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireDriver();
  const s = await getSettings(getDb());
  return (
    <div className="min-h-screen pb-24 text-[15px]">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-navy-900 px-4 py-3 text-white">
        <div>
          <p className="text-[11px] text-navy-300">{s.companyName}</p>
          <p className="text-base font-bold">{actor.name} さん</p>
        </div>
        {actor.demo && <span className="rounded bg-warn-bg px-2 py-1 text-xs font-bold text-warn">デモログイン</span>}
      </header>
      {s.demoDataLoadedAt && <div className="bg-warn-bg px-4 py-1.5 text-center text-xs font-bold text-warn">デモデータ（架空）です</div>}
      <main className="mx-auto max-w-xl px-4 py-5 [&_button]:min-h-12 [&_button]:text-base [&_input]:min-h-12 [&_select]:min-h-12">
        <Suspense fallback={null}>
          <Flash />
        </Suspense>
        {children}
      </main>
      <DriverTabs />
    </div>
  );
}
