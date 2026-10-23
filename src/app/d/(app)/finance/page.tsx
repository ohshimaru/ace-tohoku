import Link from "next/link";
import { FinanceView } from "@/components/finance-view";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireDriver } from "@/lib/session";
import { listVisibleTxns, summarize, type TxnFilter, viewerFor, visibleAccounts } from "@/server/finance-visibility";

export const metadata = { title: "入出金" };

/** スタッフの入出金（本人または所属事業部あてに公開されたものだけ） */
export default async function DriverFinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string }> }) {
  const actor = await requireDriver();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const viewer = await viewerFor(db, actor);
    const f: TxnFilter = { from: sp.from, to: sp.to, q: sp.q };
    const summary = await summarize(db, viewer, f);
    const [txns, accounts] = await Promise.all([summary.policy.viewDetails ? listVisibleTxns(db, viewer, f, 200) : Promise.resolve(null), visibleAccounts(db, viewer)]);
    return (
      <div className="space-y-4">
        <Link href="/d/more" className="text-sm text-navy-600">← その他</Link>
        <h1 className="text-xl font-bold text-navy-900">入出金（公開分）</h1>
        <p className="text-sm text-muted">あなた、またはあなたの事業部あてに公開された入出金だけを表示しています。会社全体の残高や収支ではありません。</p>
        <FinanceView summary={summary} txns={txns} filter={f} accounts={accounts} exportHref="/api/finance/export" compact />
      </div>
    );
  });
}
