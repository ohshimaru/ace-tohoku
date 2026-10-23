import { Badge } from "@/components/ui";
import { ProviderTabs } from "@/components/provider-tabs";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { assertProviderCompany } from "@/server/finance-visibility";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cid: string }> }) {
  const actor = await requireProvider();
  const { cid } = await params;
  return guard(async () => {
    const c = await assertProviderCompany(getDb(), actor, cid);
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-navy-900">{c.name}</h1>
          {c.is_demo && <Badge tone="warn">デモ（架空の会社）</Badge>}
        </div>
        <ProviderTabs cid={cid} />
        {children}
      </>
    );
  });
}
