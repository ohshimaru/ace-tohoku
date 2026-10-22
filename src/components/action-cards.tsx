import Link from "next/link";
import { setActionStatusAction } from "@/app/app/actions/actions";
import { ActionForm } from "./action-form";
import { Badge, EmptyState } from "./ui";
import { formatDate } from "@/lib/dates";
import { L } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/access";
import type { listActionCards } from "@/server/actions-engine";

type Row = Awaited<ReturnType<typeof listActionCards>>[number];

export function ActionCardList({ cards, compact = false }: { cards: Row[]; compact?: boolean }) {
  if (!cards.length) return <EmptyState title="いま対応が必要な指摘はありません">データが更新されると、ルールに基づいて自動で確認します。</EmptyState>;
  return (
    <ul className="space-y-3">
      {cards.map(({ c, assigneeName }) => (
        <li key={c.id} className="rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={L.priority[c.priority][1]}>優先度 {L.priority[c.priority][0]}</Badge>
            <Badge tone={L.action[c.status][1]}>{L.action[c.status][0]}</Badge>
            {c.needsTaxReview && <Badge tone="warn">税務は要確認</Badge>}
            <span className="font-bold text-navy-900">{c.title}</span>
          </div>
          <p className="mt-1 text-sm">{c.finding}</p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {c.evidence.map((e) => (
              <div key={e.label}><dt className="inline">{e.label}：</dt><dd className="tabular inline font-bold text-ink">{e.value}</dd></div>
            ))}
            <div><dt className="inline">対象期間：</dt><dd className="inline">{c.periodLabel}</dd></div>
          </dl>
          {!compact && <p className="mt-2 text-sm"><b>推奨する対応：</b>{c.recommendation}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span>担当：{assigneeName ?? ROLE_LABELS[c.assigneeRole]}</span>
            {c.dueDate && <span>期限：{formatDate(c.dueDate)}</span>}
            <span className="text-muted">{c.textSource === "LLM" ? "文章: AIで整形" : "文章: ルールベース"}</span>
            <Link className="text-navy-700 underline" href={c.link}>対象の明細を開く</Link>
            {!compact && c.status !== "DONE" && c.status !== "DISMISSED" && (
              <span className="flex gap-2">
                {c.status === "OPEN" && <StatusButton id={c.id} status="IN_PROGRESS" label="対応中にする" />}
                <StatusButton id={c.id} status="DONE" label="完了" />
                <StatusButton id={c.id} status="DISMISSED" label="対象外" />
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={setActionStatusAction} inline submitLabel={label} submitVariant="secondary" hideMessageOnSuccess>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}
