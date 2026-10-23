import { FinanceView } from "@/components/finance-view";
import { Notice, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listVisibleTxns, summarize, type TxnFilter, viewerFor, visibleAccounts } from "@/server/finance-visibility";

export const metadata = { title: "入出金" };

/** 本社の入出金（サービス提供者が本社向けに公開した範囲だけ。判定はサーバー側の finance-visibility） */
export default async function BankPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; q?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const viewer = await viewerFor(db, actor);
    const f: TxnFilter = { from: sp.from, to: sp.to, accountId: sp.account, q: sp.q };
    const summary = await summarize(db, viewer, f);
    const [txns, accounts] = await Promise.all([summary.policy.viewDetails ? listVisibleTxns(db, viewer, f) : Promise.resolve(null), visibleAccounts(db, viewer)]);
    const qs = new URLSearchParams(Object.entries({ from: sp.from, to: sp.to, account: sp.account, q: sp.q }).filter((e): e is [string, string] => !!e[1])).toString();
    return (
      <>
        <PageHeader title="入出金" description="サービス提供者が本社向けに公開した入出金です。銀行連携・取込・訂正・公開範囲の設定はサービス提供者が行います。このシステムは送金・振込を行いません。" />
        <div className="mb-4">
          <Notice tone="info">表示されている合計は「公開対象の入出金合計」です。{summary.balances ? "" : "実際の銀行残高は表示が許可されていません。"}会社全体の収支や残高とは一致しない場合があります。</Notice>
        </div>
        <FinanceView summary={summary} txns={txns} filter={f} accounts={accounts} detailHref={(id) => `/app/bank/${id}`} exportHref={`/api/finance/export${qs ? `?${qs}` : ""}`} />
      </>
    );
  });
}
