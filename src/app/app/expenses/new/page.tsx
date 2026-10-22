import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide } from "@/lib/access";
import { formatYen } from "@/lib/money";
import { requireStaff } from "@/lib/session";
import { listCommitments } from "@/server/budget";
import { listCategories, listDivisions } from "@/server/masters";
import { projectOptions } from "@/server/partners";
import { createExpenseAction } from "../actions";
import { ExpenseFields } from "../expense-fields";

export const metadata = { title: "経費を申請" };

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ division?: string; project?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const db = getDb();
  const [divisions, categories, projects, commitments] = await Promise.all([listDivisions(db, actor), listCategories(db), projectOptions(db, actor), listCommitments(db, actor)]);
  return (
    <>
      <PageHeader title="経費を申請" back={{ href: "/app/expenses", label: "経費一覧" }} description="承認されると、対象事業部の経費と予算に1回だけ反映されます。" />
      <Card>
        <ActionForm action={createExpenseAction} submitLabel="保存する">
          <ExpenseFields
            e={{ divisionId: sp.division, projectId: sp.project }}
            divisions={divisions}
            categories={categories}
            projects={projects}
            commitments={commitments.map((c) => ({ id: c.c.id, label: `${c.divisionName} / ${c.categoryName}：${c.c.description}（${formatYen(c.c.amount)}）` }))}
            allowCommon={isCompanyWide(actor)}
          />
          <Field label="領収書（画像またはPDF・10MBまで）"><Input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="submitNow" value="1" defaultChecked className="h-4 w-4" /> 保存と同時に申請する（外すと下書き）</label>
          <Field label="予算の申請制限を超える場合の例外承認の理由（任意）" hint="制限を超えるときだけ使われます。経営者・会社管理者の承認が必要になります"><Input name="exceptionReason" maxLength={300} /></Field>
        </ActionForm>
      </Card>
    </>
  );
}
