import { ActionForm } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { getDb } from "@/db";
import { requireDriver } from "@/lib/session";
import { myDriverContext } from "@/server/drivers";
import { createExpenseAction } from "@/app/app/expenses/actions";
import { ExpenseFields } from "@/app/app/expenses/expense-fields";

export const metadata = { title: "立替経費を申請" };

export default async function NewDriverExpense() {
  const actor = await requireDriver();
  const ctx = await myDriverContext(getDb(), actor);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">立替経費を申請</h1>
      <Card>
        <ActionForm action={createExpenseAction} submitLabel="申請する" className="space-y-4 [&_button[type=submit]]:w-full">
          <input type="hidden" name="returnTo" value="/d/expenses/new" />
          <input type="hidden" name="submitNow" value="1" />
          <ExpenseFields e={{ divisionId: ctx.divisionId }} divisions={[{ id: ctx.divisionId, name: ctx.divisionName }]} categories={ctx.categories} projects={ctx.projects} allowCommon={false} driver />
          <Field label="領収書の写真（画像またはPDF・10MBまで）" required><Input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" required /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}
