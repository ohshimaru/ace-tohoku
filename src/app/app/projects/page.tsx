import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { saveProjectAction } from "@/app/app/partners/actions";
import { Badge, Card, EmptyState, Field, FilterBar, Input, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { listProjects, partnerOptions } from "@/server/partners";
import { ProjectFields } from "./project-fields";

export const metadata = { title: "案件" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; division?: string; status?: string; page?: string; customer?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const [data, divisions, customers] = await Promise.all([listProjects(db, actor, { q: sp.q, divisionId: sp.division, status: sp.status, page: sp.page }), listDivisions(db, actor), partnerOptions(db, actor, "customer")]);
    return (
      <>
        <PageHeader title="案件" />
        <FilterBar>
          <Field label="検索"><Input name="q" defaultValue={sp.q ?? ""} placeholder="コード・案件名" /></Field>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="状態"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option>{Object.entries(L.projectStatus).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </FilterBar>
        <Card>
          {data.rows.length === 0 ? <EmptyState title="案件はありません" /> : (
            <Table>
              <thead><tr><Th>コード</Th><Th>案件名・顧客</Th><Th>事業部・区分</Th><Th>契約</Th><Th className="text-right">契約金額</Th><Th>期間・納期</Th><Th>状態</Th></tr></thead>
              <tbody>{data.rows.map((p) => (
                <tr key={p.id} className="hover:bg-navy-50/50">
                  <Td className="font-mono text-xs">{p.code}</Td>
                  <Td><Link className="font-medium text-navy-700 hover:underline" href={`/app/projects/${p.id}`}>{p.name}</Link><div className="text-xs text-muted">{p.customerName ?? ""}</div>{p.externalSource && <Badge tone="info">Clean Up連携</Badge>}</Td>
                  <Td>{p.divisionName}<div className="text-xs text-muted">{p.category}</div></Td>
                  <Td>{L.contractType[p.contractType]}</Td>
                  <Td className="tabular text-right">{formatYen(p.amount)}{p.contractType === "MONTHLY" ? "/月" : ""}</Td>
                  <Td className="text-xs">{formatDate(p.startDate)}〜{p.endDate ? formatDate(p.endDate) : ""}{p.dueDate && <div>納期 {formatDate(p.dueDate)}</div>}</Td>
                  <Td><Badge tone={L.projectStatus[p.status][1]}>{L.projectStatus[p.status][0]}</Badge></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          <Pagination page={data.page} total={data.total} limit={data.limit} params={{ q: sp.q, division: sp.division, status: sp.status }} />
        </Card>
        <Card title="案件を登録" className="mt-6" id="new">
          <ActionForm action={saveProjectAction} submitLabel="登録する"><ProjectFields divisions={divisions} customers={customers} p={{ customerId: sp.customer, divisionId: sp.division }} /></ActionForm>
        </Card>
      </>
    );
  });
}
