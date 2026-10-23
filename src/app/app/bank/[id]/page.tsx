import { Badge, Card, DefList, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { getVisibleTxn, viewerFor } from "@/server/finance-visibility";

export const metadata = { title: "入出金" };

/** 公開された取引の詳細（公開されていない・公開停止の取引は「見つからない」） */
export default async function TxnPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const t = await getVisibleTxn(db, await viewerFor(db, actor), id);
    return (
      <>
        <PageHeader title={`${formatDate(t.date)}　${t.amount > 0 ? "入金" : "出金"} ${formatYen(Math.abs(t.amount))}`} back={{ href: "/app/bank", label: "入出金" }} />
        <Card title="取引">
          <DefList items={[["口座", t.account], ["内容", t.description], ["区分", L.bankClass[t.classification]], ["案件", t.project ?? "—"], ["集計", t.excluded ? <Badge key="x">集計対象外</Badge> : "集計対象"], ["訂正", t.corrected ? "サービス提供者が訂正した値を表示しています" : "—"]]} />
        </Card>
      </>
    );
  });
}
