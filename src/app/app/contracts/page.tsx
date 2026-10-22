import Link from "next/link";
import { Badge, Card, EmptyState, Field, FilterBar, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { addDays, formatDate, todayJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listContracts } from "@/server/contracts";

export const metadata = { title: "契約書" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const rows = await listContracts(getDb(), actor, { status: sp.status });
    const today = todayJst();
    return (
      <>
        <PageHeader title="契約書" description="承認済みのテンプレートに契約条件を差し込んで作成します。下書き → 社内確認済み → 送付済み → 締結済み → 終了。送付・締結は人が行い、締結済みの契約書ファイルを保存します。" actions={<>{can.manageContracts(actor) && <LinkButton href="/app/contracts/new" variant="primary">＋ 契約書を作成</LinkButton>}<LinkButton href="/app/contracts/templates">テンプレート</LinkButton></>} />
        <FilterBar><Field label="状態"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option>{Object.entries(L.contract).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</Select></Field></FilterBar>
        <Card>
          {rows.length === 0 ? <EmptyState title="契約書はありません" /> : (
            <Table>
              <thead><tr><Th>契約名</Th><Th>取引先</Th><Th>事業部</Th><Th>立場</Th><Th>期間終了</Th><Th>版</Th><Th>状態</Th></tr></thead>
              <tbody>{rows.map(({ c, partnerName, divisionName, driverName }) => {
                const soon = c.status === "SIGNED" && c.periodEnd && c.periodEnd <= addDays(today, c.renewalNoticeDays);
                return (
                  <tr key={c.id}>
                    <Td><Link className="font-bold text-navy-700 underline" href={`/app/contracts/${c.id}`}>{c.title}</Link>{driverName && <div className="text-xs text-muted">ドライバー: {driverName}</div>}</Td>
                    <Td>{partnerName}</Td>
                    <Td>{divisionName}</Td>
                    <Td className="text-xs">{c.ourSide === "ORDERER" ? "発注" : "受注"}</Td>
                    <Td className={soon ? "font-bold text-bad" : ""}>{formatDate(c.periodEnd)}{soon && <div><Badge tone="bad">更新期限が近い</Badge></div>}</Td>
                    <Td>第{c.revision}版</Td>
                    <Td><Badge tone={L.contract[c.status][1]}>{L.contract[c.status][0]}</Badge></Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>
      </>
    );
  });
}
