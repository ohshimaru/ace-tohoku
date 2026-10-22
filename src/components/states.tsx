import { LinkButton } from "./ui";

export function Forbidden({ message = "この画面を表示する権限がありません。" }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-surface p-8 text-center">
      <p className="text-3xl" aria-hidden>
        🔒
      </p>
      <h1 className="mt-2 text-lg font-bold text-navy-900">権限がありません</h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <p className="mt-1 text-sm text-muted">必要な場合は管理者に権限の付与を依頼してください。</p>
      <LinkButton href="/app" className="mt-6">
        ダッシュボードへ戻る
      </LinkButton>
    </div>
  );
}
