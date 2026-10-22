import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { listPartners } from "@/server/partners";
import { savePartnerAction } from "./actions";
import { PartnerFields } from "./partner-fields";

export const metadata = { title: "顧客・取引先" };

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; division?: string; page?: string; archived?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const [data, divisions] = await Promise.all([listPartners(db, actor, { q: sp.q, role: sp.role, divisionId: sp.division, page: sp.page, archived: sp.archived === "1" }), listDivisions(db, actor)]);
    return (
      <>
        <PageHeader title="顧客・取引先" description="顧客と業務委託先を区別して管理します。同じ取引先が両方の役割を持つこともできます。" />
        <FilterBar>
          <Field label="検索"><Input name="q" defaultValue={sp.q ?? ""} placeholder="名称・フリガナ" /></Field>
          <Field label="役割"><Select name="role" defaultValue={sp.role ?? ""}><option value="">すべて</option><option value="customer">顧客</option><option value="contractor">業務委託先</option></Select></Field>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="表示"><Select name="archived" defaultValue={sp.archived ?? ""}><option value="">有効</option><option value="1">アーカイブ済み</option></Select></Field>
        </FilterBar>
        <Card>
          {data.rows.length === 0 ? <EmptyState title="取引先はありません" /> : (
            <Table>
              <thead><tr><Th>名称</Th><Th>役割</Th><Th>事業部</Th><Th>担当者・電話</Th><Th className="text-right">案件数</Th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-navy-50/50">
                  <Td><Link className="font-medium text-navy-700 hover:underline" href={`/app/partners/${r.id}`}>{r.name}</Link><div className="text-xs text-muted">{r.type === "CORPORATION" ? "法人" : "個人"}</div></Td>
                  <Td><span className="flex gap-1">{r.isCustomer && <Badge tone="info">顧客</Badge>}{r.isContractor && <Badge tone="navy">委託先</Badge>}</span></Td>
                  <Td className="text-xs">{r.divisions || "—"}</Td>
                  <Td className="text-xs">{r.contactName ?? ""} {r.phone ?? ""}</Td>
                  <Td className="tabular text-right">{r.projectCount}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          <Pagination page={data.page} total={data.total} limit={data.limit} params={{ q: sp.q, role: sp.role, division: sp.division, archived: sp.archived }} />
        </Card>
        <Card title="取引先を登録" className="mt-6">
          <ActionForm action={savePartnerAction} submitLabel="登録する"><PartnerFields divisions={divisions} divisionIds={sp.division ? [sp.division] : []} /></ActionForm>
        </Card>
      </>
    );
  });
}
