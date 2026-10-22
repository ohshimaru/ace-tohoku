import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-surface p-8 text-center">
      <h1 className="text-lg font-bold text-navy-900">データが見つかりません</h1>
      <p className="mt-2 text-sm text-muted">存在しないか、閲覧する権限がありません。</p>
      <LinkButton href="/app" className="mt-6">
        ダッシュボードへ戻る
      </LinkButton>
    </div>
  );
}
