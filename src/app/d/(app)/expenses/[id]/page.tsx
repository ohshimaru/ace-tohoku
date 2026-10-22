import { ExpenseDetail } from "@/components/expense-detail";
import { getDb } from "@/db";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireDriver } from "@/lib/session";
import { myDriverContext } from "@/server/drivers";
import { getExpense } from "@/server/expenses";

export const metadata = { title: "立替経費" };

export default async function DriverExpense({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDriver();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getExpense(db, actor, id);
    const editable = x.e.status === "DRAFT" || x.e.status === "RETURNED";
    const ctx = editable ? await myDriverContext(db, actor) : null;
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-navy-900">{x.e.payee}　{formatYen(x.e.amount)}</h1>
        <ExpenseDetail x={x} actor={actor} base="/d" edit={ctx ? { divisions: [{ id: ctx.divisionId, name: ctx.divisionName }], categories: ctx.categories, projects: ctx.projects, commitments: [], allowCommon: false } : null} />
      </div>
    );
  });
}
