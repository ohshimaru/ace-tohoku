"use client";

import { Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-bad/30 bg-surface p-8 text-center" role="alert">
      <h1 className="text-lg font-bold text-bad">画面を表示できませんでした</h1>
      <p className="mt-2 text-sm text-muted">通信エラー、またはサーバーで問題が発生しました。ネットワーク接続を確認し、再度お試しください。</p>
      {error.digest && <p className="mt-2 text-xs text-muted">エラー番号: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        再読み込み
      </Button>
    </div>
  );
}
