import { ActionForm } from "@/components/action-form";
import { saveProjectAction } from "@/app/app/partners/actions";
import { Metric } from "@/components/metric";
import { Badge, Card, DefList, LinkButton, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { getProjectPL } from "@/server/metrics";
import { getProject, partnerOptions } from "@/server/partners";
import { ProjectFields } from "../project-fields";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getProject(db, actor, id);
    const p = x.project;
    const [pls, divisions, customers] = await Promise.all([getProjectPL(db, actor, { from: "2000-01", to: "2099-12", divisionId: p.divisionId }), listDivisions(db, actor), partnerOptions(db, actor, "customer")]);
    const pl = pls.find((r) => r.id === id) ?? { sales: 0, expenses: 0, statement_cost: 0, cost: 0, profit: 0 };
    return (
      <>
        <PageHeader
          title={`${p.code} ${p.name}`}
          back={{ href: "/app/projects", label: "案件一覧" }}
          description={<span className="flex flex-wrap gap-1"><Badge>{x.divisionName}</Badge><Badge>{L.contractType[p.contractType]}</Badge><Badge tone={L.projectStatus[p.status][1]}>{L.projectStatus[p.status][0]}</Badge>{p.externalSource && <Badge tone="info">Clean Up 外部ID: {p.externalId}</Badge>}</span>}
          actions={<><LinkButton href={`/app/sales?project=${p.id}&from=2000-01&to=2099-12`}>売上</LinkButton><LinkButton href={`/app/expenses?project=${p.id}`}>経費</LinkButton><LinkButton href={`/app/expenses/new?division=${p.divisionId}&project=${p.id}`}>経費を申請</LinkButton>{x.divisionKind === "DRIVER" && <LinkButton href={`/app/shifts?project=${p.id}`}>稼働枠</LinkButton>}</>}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label="売上（累計・税抜）" value={pl.sales} href={`/app/sales?project=${p.id}&from=2000-01&to=2099-12`} />
          <Metric label="経費（承認済み）" value={pl.expenses} />
          <Metric label="外注費（稼働明細）" value={pl.statement_cost} />
          <Metric label="原価合計" value={pl.cost} />
          <Metric label="案件利益（配賦前）" value={pl.profit} note={pl.sales > 0 ? `利益率 ${Math.round((pl.profit / pl.sales) * 1000) / 10}%` : undefined} />
        </div>
        <Card title="契約内容" className="mt-4">
          <DefList items={[["顧客", x.customerName ?? "—"], ["案件区分", p.category || "—"], ["契約金額", `${formatYen(p.amount)}${p.contractType === "MONTHLY" ? "／月" : ""}（税抜）`], ["期間", `${formatDate(p.startDate)} 〜 ${p.endDate ? formatDate(p.endDate) : ""}`], ["納期", formatDate(p.dueDate)]]} />
        </Card>
        <Card title="編集" className="mt-4">
          <ActionForm action={saveProjectAction} submitLabel="保存する"><input type="hidden" name="id" value={p.id} /><ProjectFields p={p} divisions={divisions} customers={customers} /></ActionForm>
        </Card>
      </>
    );
  });
}
