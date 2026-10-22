export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="sr-only">読み込み中…</p>
      <div className="h-8 w-48 animate-pulse rounded bg-navy-100" />
      <div className="h-32 animate-pulse rounded-lg bg-navy-50" />
      <div className="h-64 animate-pulse rounded-lg bg-navy-50" />
    </div>
  );
}
