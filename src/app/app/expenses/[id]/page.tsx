import { ExpenseDetail } from "@/components/expense-detail";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { isCompanyWide } from "@/lib/access";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listCommitments } from "@/server/budget";
import { getExpense } from "@/server/expenses";
import { listCategories, listDivisions } from "@/server/masters";
import { projectOptions } from "@/server/partners";

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getExpense(db, actor, id);
    const editable = x.isOwn && (x.e.status === "DRAFT" || x.e.status === "RETURNED");
    const [divisions, categories, projects, commitments] = editable ? await Promise.all([listDivisions(db, actor), listCategories(db), projectOptions(db, actor), listCommitments(db, actor)]) : [[], [], [], []];
    return (
      <>
        <PageHeader title={`${x.e.payee}　${formatYen(x.e.amount)}`} back={{ href: "/app/expenses", label: "経費一覧" }} />
        <ExpenseDetail
          x={x}
          actor={actor}
          base="/app"
          edit={editable ? { divisions, categories, projects, commitments: commitments.map((c) => ({ id: c.c.id, label: `${c.divisionName}：${c.c.description}（${formatYen(c.c.amount)}）` })), allowCommon: isCompanyWide(actor) } : null}
        />
      </>
    );
  });
}
