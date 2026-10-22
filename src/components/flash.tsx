"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FLASH } from "@/lib/flash";
import { Notice } from "./ui";

/** ?flash=コード の結果メッセージを表示し、URLからは取り除く（再読み込みで再表示しない） */
export function Flash() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const code = sp.get("flash");
  const [shown, setShown] = useState<{ code: string | null; msg: string | null }>({ code, msg: code ? (FLASH[code] ?? null) : null });
  // 新しいコードを受け取ったら表示内容を切り替える（描画中の状態調整）
  if (code && code !== shown.code) setShown({ code, msg: FLASH[code] ?? null });
  // 別の画面へ移動したらメッセージを消す
  const [shownPath, setShownPath] = useState(path);
  if (path !== shownPath) {
    setShownPath(path);
    if (!code) setShown({ code: null, msg: null });
  }
  useEffect(() => {
    if (!code) return;
    const next = new URLSearchParams(sp.toString());
    next.delete("flash");
    const q = next.toString();
    router.replace(q ? `${path}?${q}` : path, { scroll: false });
  }, [code, path, router, sp]);
  if (!shown.msg) return null;
  return (
    <div className="mb-4">
      <Notice tone={shown.code === "submit_failed" ? "warn" : "ok"}>{shown.msg}</Notice>
    </div>
  );
}
