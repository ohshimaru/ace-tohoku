import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { listAssignedCompanies } from "@/server/provider-finance";

export const metadata = { title: "担当会社" };

export default async function ProviderHome() {
  const actor = await requireProvider();
  return guard(async () => {
    const companies = await listAssignedCompanies(getDb(), actor);
    return (
      <>
        <PageHeader title="担当会社" description="担当している会社だけが表示されます。担当の追加・解除は運営側で行います。" />
        {companies.length === 0 ? <EmptyState title="担当している会社はありません" /> : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {companies.map((c) => (
              <Card key={c.id} title={<Link className="text-navy-800 underline" href={`/p/${c.id}`}>{c.name}</Link>} actions={c.is_demo ? <Badge tone="warn">デモ</Badge> : undefined}>
                <p className="text-sm">口座 {c.accounts}件・下書きの取引 <b>{c.drafts}件</b>{c.failed > 0 && <Badge tone="bad">同期失敗 {c.failed}件</Badge>}</p>
              </Card>
            ))}
          </div>
        )}
      </>
    );
  });
}
