import { expenseOpAction, removeExpenseFileAction, updateExpenseAction, uploadExpenseFileAction } from "@/app/app/expenses/actions";
import { ExpenseFields } from "@/app/app/expenses/expense-fields";
import type { Actor } from "@/lib/access";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import type { getExpense } from "@/server/expenses";
import { ActionForm } from "./action-form";
import { Badge, Card, DefList, Field, Input, Notice } from "./ui";

type X = Awaited<ReturnType<typeof getExpense>>;
type Opt = { id: string; name: string };

function Op({ id, op, label, variant = "secondary", reason, base, confirm, extra }: { id: string; op: string; label: string; variant?: "primary" | "secondary" | "danger"; reason?: string; base: string; confirm?: string; extra?: React.ReactNode }) {
  return (
    <ActionForm action={expenseOpAction} inline submitLabel={label} submitVariant={variant} confirm={confirm}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="returnTo" value={`${base}/expenses/${id}`} />
      {reason && <Input name="reason" placeholder={reason} required className="w-56" />}
      {extra}
    </ActionForm>
  );
}

export function ExpenseDetail({ x, actor, base, edit }: { x: X; actor: Actor; base: "/app" | "/d"; edit: { divisions: Opt[]; categories: Opt[]; projects: { id: string; code: string; name: string }[]; commitments: { id: string; label: string }[]; allowCommon: boolean } | null }) {
  const e = x.e;
  const canCancel = e.status !== "CANCELED" && e.status !== "REJECTED" && ((x.isOwn && e.status !== "APPROVED") || (e.status === "APPROVED" && (actor.role === "OWNER" || actor.role === "ACCOUNTING")));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone={L.expenseStatus[e.status][1]}>状況：{L.expenseStatus[e.status][0]}</Badge>
        <Badge>{L.settlement[e.settlement]}</Badge>
        {x.payable && <Badge tone={L.payable[x.payable.status][1]}>支払：{L.payable[x.payable.status][0]}（予定日 {formatDate(x.payable.dueDate)}）</Badge>}
        {e.statementLineId && <Badge tone="navy">稼働明細で精算済み</Badge>}
        {e.budgetExceptionById && <Badge tone="warn">予算超過の例外承認</Badge>}
      </div>
      {e.status === "RETURNED" && <Notice tone="warn" title="差戻しされました">{e.decisionNote}（{formatDateTime(e.decidedAt)}）。内容を直して再申請してください。</Notice>}
      {e.status === "REJECTED" && <Notice tone="bad" title="却下されました">{e.decisionNote}</Notice>}
      {e.status === "CANCELED" && <Notice tone="bad" title="取消済み">{e.cancelReason}</Notice>}
      {x.budget && !x.budget.ok && (
        <Notice tone={x.budget.blocked ? "bad" : "warn"} title={`予算の確認：${x.budget.blocked ? "申請制限を超えます" : "警告"}`}>
          <ul className="list-disc pl-5">{x.budget.messages.map((m) => <li key={m}>{m}</li>)}</ul>
          {x.budget.blocked && <p className="mt-1">申請するには例外承認の理由が必要です（経営者・会社管理者が承認します）。</p>}
        </Notice>
      )}
      {e.budgetExceptionNote && <Notice tone="warn" title="例外承認の理由">{e.budgetExceptionNote}</Notice>}
      <Card title="内容">
        <DefList
          items={[
            ["申請者", x.applicantName],
            ["利用日（計上月）", `${formatDate(e.usedOn)}（${e.month}）`],
            ["事業部", x.divisionName ?? "共通経費（全社）"],
            ["案件", x.projectCode ? `${x.projectCode} ${x.projectName}` : "—"],
            ["費目", x.categoryName],
            ["支払先", e.payee],
            ["用途", e.purpose],
            ["金額（税込）", formatYen(e.amount)],
            ["税区分・消費税", `${L.tax[e.taxRate]}・${formatYen(e.taxAmount)}（税抜 ${formatYen(e.amount - e.taxAmount)}）`],
            ["申請日時", formatDateTime(e.submittedAt)],
            ["処理", e.decidedAt ? formatDateTime(e.decidedAt) : "—"],
          ]}
        />
      </Card>
      <Card title="操作">
        <div className="flex flex-col gap-3">
          {x.isOwn && (e.status === "DRAFT" || e.status === "RETURNED") && (
            <Op id={e.id} op="submit" label={e.status === "RETURNED" ? "再申請する" : "申請する"} variant="primary" base={base} extra={x.budget?.blocked ? <Input name="exceptionReason" placeholder="例外承認を求める理由" required className="w-64" /> : null} />
          )}
          {x.canDecide && (
            <>
              <Op id={e.id} op="approve" label={x.budget?.blocked ? "例外として承認する" : "承認する"} variant="primary" base={base} confirm="承認しますか？承認すると経費・予算に反映されます" />
              <Op id={e.id} op="return" label="差戻す" base={base} reason="差戻し理由（修正してもらう内容）" />
              <Op id={e.id} op="reject" label="却下する" variant="danger" base={base} reason="却下理由" />
            </>
          )}
          {canCancel && <Op id={e.id} op="cancel" label="取消す" variant="danger" base={base} reason="取消理由" confirm="取消しますか？（履歴は残ります）" />}
          {x.isOwn && e.status === "SUBMITTED" && <p className="text-xs text-muted">承認者の処理を待っています。自分の申請は承認できません。</p>}
          {e.status === "APPROVED" && <p className="text-xs text-muted">承認済みの経費は直接編集できません。誤りがある場合は経理が取消し、改めて申請してください。</p>}
        </div>
      </Card>
      <Card title="領収書">
        {x.files.length === 0 ? <p className="text-sm text-muted">添付はありません。</p> : (
          <ul className="divide-y divide-line text-sm">
            {x.files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a className="text-navy-700 underline" href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.name}</a>
                <span className="flex items-center gap-2 text-xs text-muted">{Math.ceil(f.size / 1024)} KB
                  {edit && (
                    <ActionForm action={removeExpenseFileAction} inline submitLabel="削除" submitVariant="danger">
                      <input type="hidden" name="id" value={e.id} /><input type="hidden" name="fileId" value={f.id} /><input type="hidden" name="returnTo" value={`${base}/expenses/${e.id}`} />
                    </ActionForm>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {edit && (
          <div className="mt-3 border-t border-line pt-3">
            <ActionForm action={uploadExpenseFileAction} submitLabel="添付する" submitVariant="secondary" resetOnSuccess>
              <input type="hidden" name="id" value={e.id} /><input type="hidden" name="returnTo" value={`${base}/expenses/${e.id}`} />
              <Field label="画像またはPDF（10MBまで・5ファイルまで）"><Input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" required /></Field>
            </ActionForm>
          </div>
        )}
      </Card>
      {edit && (
        <Card title="内容の修正">
          <ActionForm action={updateExpenseAction} submitLabel="保存する" submitVariant="secondary">
            <input type="hidden" name="id" value={e.id} /><input type="hidden" name="returnTo" value={`${base}/expenses/${e.id}`} />
            <ExpenseFields e={e} divisions={edit.divisions} categories={edit.categories} projects={edit.projects} commitments={edit.commitments} allowCommon={edit.allowCommon} driver={base === "/d"} />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
