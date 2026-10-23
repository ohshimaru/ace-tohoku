import { Card, EmptyState, Pagination, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { companyAudit } from "@/server/provider-finance";

export const metadata = { title: "操作履歴" };

export default async function ProviderAuditPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<{ page?: string }> }) {
  const actor = await requireProvider();
  const { cid } = await params;
  const page = Number((await searchParams).page) || 1;
  return guard(async () => {
    const r = await companyAudit(getDb(), actor, cid, page);
    return (
      <Card title="入出金・口座・公開設定・出力の操作履歴（削除・変更できません）">
        {r.rows.length === 0 ? <EmptyState title="操作履歴はありません" /> : (
          <Table>
            <thead><tr><Th>日時</Th><Th>実行者</Th><Th>操作</Th><Th>内容</Th><Th>変更前 → 変更後</Th></tr></thead>
            <tbody>{r.rows.map((l) => (
              <tr key={l.id}><Td className="whitespace-nowrap text-xs">{formatDateTime(l.at)}</Td><Td>{l.actor_name}</Td><Td className="text-xs">{l.action}</Td><Td>{l.summary}</Td><Td className="max-w-md break-all text-xs text-muted">{l.changes ? JSON.stringify(l.changes) : ""}</Td></tr>
            ))}</tbody>
          </Table>
        )}
        <Pagination page={r.page} total={r.total} limit={50} params={{}} />
      </Card>
    );
  });
}
