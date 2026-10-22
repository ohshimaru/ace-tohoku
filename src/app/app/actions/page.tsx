import { ActionCardList } from "@/components/action-cards";
import { ActionForm } from "@/components/action-form";
import { Card, Field, FilterBar, PageHeader, Select } from "@/components/ui";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listActionCards } from "@/server/actions-engine";
import { refreshCardsAction } from "./actions";

export const metadata = { title: "対応すること" };

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const status = sp.status === "done" ? "done" : sp.status === "all" ? "all" : "active";
    const cards = await listActionCards(getDb(), actor, { status });
    return (
      <>
        <PageHeader title="対応すること" description="保存されたデータから、ルールに基づいて指摘と対応案を作っています。根拠が解消されると自動で閉じます。" actions={<ActionForm action={refreshCardsAction} inline submitLabel="いま確認する" submitVariant="secondary" />} />
        <FilterBar><Field label="表示"><Select name="status" defaultValue={status}><option value="active">未対応・対応中</option><option value="done">完了・対象外</option><option value="all">すべて</option></Select></Field></FilterBar>
        <Card><ActionCardList cards={cards} /></Card>
        <p className="mt-3 text-xs text-muted">このシステムが支払い・契約締結・予算変更を自動で行うことはありません。税務上の判断が必要な内容は「税務は要確認」と表示しています。定期処理（1日1回）でも自動的に確認します。</p>
      </>
    );
  });
}
