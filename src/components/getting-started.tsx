"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GuideStep } from "@/lib/guide";

const KEY = "ace.guide.hidden";

/** ダッシュボード上部の「まずはここから」。閉じた状態はこのブラウザだけに保存 */
export function GettingStarted({ steps, demo }: { steps: GuideStep[]; demo: boolean }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setHidden(true); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);
  if (hidden) return null;
  return (
    <section aria-labelledby="gs-title" className="mb-6 rounded-lg border border-navy-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="gs-title" className="text-lg font-bold text-navy-900">まずはここから</h2>
          <p className="text-sm text-muted">あなたの立場でよく使う4つの画面です。{demo && "デモの数字はすべて架空です。自由に操作してかまいません。"}</p>
        </div>
        <button type="button" className="min-h-10 rounded-md px-3 text-sm text-navy-700 hover:bg-navy-50" onClick={() => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch {} }}>
          閉じる
        </button>
      </div>
      <ol className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.href} className="flex flex-col rounded-md border border-line p-4">
            <p className="text-xs font-bold text-navy-500">ステップ {i + 1}</p>
            <p className="mt-1 font-bold text-navy-900">{s.title}</p>
            <p className="mt-1 flex-1 text-sm text-muted">{s.body}</p>
            <Link href={s.href} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md bg-navy-700 px-3 text-sm font-bold text-white hover:bg-navy-800">{s.cta}</Link>
          </li>
        ))}
      </ol>
      {demo && <p className="mt-3 text-sm">ほかの立場（経理・事業部責任者・ドライバー）で試すときは、左下の「ログアウト」から別の人を選んでください。ドライバー画面はスマホでの表示を想定しています。</p>}
    </section>
  );
}
