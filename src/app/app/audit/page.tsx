import { Card, EmptyState, Field, FilterBar, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listAuditLogs } from "@/server/masters";

export const metadata = { title: "監査ログ" };
const TYPES: [string, string][] = [["", "すべて"], ["sale", "売上・入金"], ["expense", "経費"], ["payable", "支払"], ["budget_rule", "予算ルール"], ["budget_request", "予算追加"], ["month_close", "月次締め"], ["statement", "稼働明細"], ["daily_report", "日報"], ["assignment", "稼働割当"], ["contract", "契約"], ["bank_account", "銀行"], ["app_user", "利用者"], ["company_setting", "設定"], ["import_run", "取込"]];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const data = await listAuditLogs(getDb(), actor, { page: sp.page, entityType: sp.type || undefined });
    return (
      <>
        <PageHeader title="監査ログ" description="承認・締め・訂正・契約変更などの記録です。データベースの設定で変更・削除できません。" />
        <FilterBar><Field label="対象"><Select name="type" defaultValue={sp.type ?? ""}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></FilterBar>
        <Card>
          {data.rows.length === 0 ? <EmptyState title="記録はありません" /> : (
            <Table>
              <thead><tr><Th>日時</Th><Th>操作者</Th><Th>操作</Th><Th>内容</Th><Th>変更</Th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id}><Td className="whitespace-nowrap text-xs">{formatDateTime(r.at)}</Td><Td>{r.actorName}</Td><Td className="font-mono text-xs">{r.action}</Td><Td>{r.summary}</Td>
                  <Td>{r.changes ? <details><summary className="cursor-pointer text-xs text-navy-700">表示</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(r.changes, null, 2)}</pre></details> : "—"}</Td></tr>
              ))}</tbody>
            </Table>
          )}
          <Pagination page={data.page} total={data.total} limit={data.limit} params={{ type: sp.type }} />
        </Card>
      </>
    );
  });
}
