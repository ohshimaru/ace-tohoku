import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { expenseOpAction } from "@/app/app/expenses/actions";
import { decideBudgetRequestAction } from "@/app/app/budget/actions";
import { Badge, Card, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listBudgetRequests } from "@/server/budget";
import { listPendingForDecision } from "@/server/expenses";
import { PendingReports } from "./pending-reports";

export const metadata = { title: "承認" };

export default async function ApprovalsPage() {
  const actor = await requireStaff();
  return guard(async () => {
    const db = getDb();
    const [expenses, requests] = await Promise.all([listPendingForDecision(db, actor), listBudgetRequests(db, actor)]);
    const pendingReq = requests.filter((r) => r.r.status === "PENDING");
    return (
      <>
        <PageHeader title="承認" description="あなたが処理できる申請だけを表示しています。自分の申請は承認できません。" />
        <Card title={`経費（${expenses.length}件）`}>
          {expenses.length === 0 ? <EmptyState title="承認待ちの経費はありません" /> : (
            <Table>
              <thead><tr><Th>申請日時</Th><Th>申請者・事業部</Th><Th>利用日・支払先</Th><Th className="text-right">金額</Th><Th>操作</Th></tr></thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <Td className="text-xs">{formatDateTime(e.submittedAt)}</Td>
                    <Td>{e.applicantName}<div className="text-xs text-muted">{e.divisionName ?? "共通経費"}</div></Td>
                    <Td><Link className="text-navy-700 underline" href={`/app/expenses/${e.id}`}>{formatDate(e.usedOn)} {e.payee}</Link>{e.exceptionNote && <div><Badge tone="warn">予算超過の例外申請</Badge></div>}</Td>
                    <Td className="tabular text-right">{formatYen(e.amount)}</Td>
                    <Td>
                      <div className="flex flex-col gap-2">
                        {e.exceptionNote && actor.role !== "OWNER" ? <span className="text-xs text-muted">例外承認は経営者のみ</span> : (
                          <ActionForm action={expenseOpAction} inline submitLabel="承認" confirm="承認しますか？">
                            <input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="approve" /><input type="hidden" name="returnTo" value="/app/approvals" />
                          </ActionForm>
                        )}
                        <ActionForm action={expenseOpAction} inline submitLabel="差戻し" submitVariant="secondary">
                          <input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="return" /><input type="hidden" name="returnTo" value="/app/approvals" />
                          <Input name="reason" placeholder="差戻し理由" required className="w-40" />
                        </ActionForm>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted">領収書は経費の詳細画面で確認できます。予算の申請制限を超える申請は、経営者・会社管理者のみ例外承認できます。</p>
        </Card>
        <PendingReports actor={actor} />
        <Card title={`予算追加申請（${pendingReq.length}件）`} className="mt-4">
          {pendingReq.length === 0 ? <EmptyState title="承認待ちの予算追加申請はありません" /> : (
            <ul className="divide-y divide-line">
              {pendingReq.map(({ r, divisionName }) => (
                <li key={r.id} className="py-3 text-sm">
                  <p><b>{divisionName}</b> {r.month}：<b className="tabular">{formatYen(r.amount)}</b> — {r.reason}</p>
                  {can.editBudgetRules(actor) && r.requestedById !== actor.userId ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionForm action={decideBudgetRequestAction} inline submitLabel="承認（予算を追加）" confirm="予算を追加しますか？"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                      <ActionForm action={decideBudgetRequestAction} inline submitLabel="却下" submitVariant="danger"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Input name="note" placeholder="理由" className="w-40" /></ActionForm>
                    </div>
                  ) : <p className="text-xs text-muted">経営者・会社管理者が判断します。</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  });
}
