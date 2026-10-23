import { ProviderTxnTable } from "@/components/provider-txn-table";
import { Field, FilterBar, Input, Notice, Select } from "@/components/ui";
import { getDb } from "@/db";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { listBankAccounts } from "@/server/bank";
import { audienceOptions, type ProviderFilter, providerListTxns } from "@/server/provider-finance";

export const metadata = { title: "入出金と公開状況" };

type SP = { from?: string; to?: string; account?: string; q?: string; classification?: string; project?: string; status?: string; hq?: string; staff?: string; excluded?: string };

export default async function ProviderTxnsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<SP> }) {
  const actor = await requireProvider();
  const { cid } = await params;
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const f: ProviderFilter = { from: sp.from, to: sp.to, accountId: sp.account, q: sp.q, classification: sp.classification, projectId: sp.project, status: sp.status, hq: sp.hq, staff: sp.staff, excluded: sp.excluded };
    const [rows, accounts, opts] = await Promise.all([providerListTxns(db, actor, cid, f), listBankAccounts(db, actor, cid), audienceOptions(db, actor, cid)]);
    const drafts = rows.filter((r) => r.publish_status === "DRAFT").length;
    return (
      <>
        <Notice tone="info" title="公開の考え方">
          新しく取り込んだ取引は「下書き」で、あなた（提供者）だけが見えます。本社とスタッフへの公開は取引ごとに別々に設定します。非公開にしても原本と集計の元データは消えません。重複・誤取込は詳細画面で「集計対象外」にしてください。
        </Notice>
        <div className="mt-4">
          <FilterBar>
            <Field label="期間（から）"><Input type="date" name="from" defaultValue={sp.from ?? ""} /></Field>
            <Field label="期間（まで）"><Input type="date" name="to" defaultValue={sp.to ?? ""} /></Field>
            <Field label="口座"><Select name="account" defaultValue={sp.account ?? ""}><option value="">すべて</option>{accounts.map(({ a }) => <option key={a.id} value={a.id}>{a.bankName} ****{a.accountNumberLast4}</option>)}</Select></Field>
            <Field label="分類"><Select name="classification" defaultValue={sp.classification ?? ""}><option value="">すべて</option>{Object.entries(L.bankClass).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {opts.projects.length > 0 && <Field label="案件"><Select name="project" defaultValue={sp.project ?? ""}><option value="">すべて</option>{opts.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
            <Field label="公開状態"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option><option value="DRAFT">下書き</option><option value="PUBLISHED">公開中</option><option value="SUSPENDED">公開停止</option></Select></Field>
            <Field label="本社公開"><Select name="hq" defaultValue={sp.hq ?? ""}><option value="">すべて</option><option value="1">公開する</option><option value="0">しない</option></Select></Field>
            <Field label="スタッフ公開"><Select name="staff" defaultValue={sp.staff ?? ""}><option value="">すべて</option><option value="1">公開する</option><option value="0">しない</option></Select></Field>
            <Field label="内容で検索"><Input name="q" defaultValue={sp.q ?? ""} maxLength={50} /></Field>
          </FilterBar>
        </div>
        <p className="mb-2 text-sm">表示中 {rows.length}件（うち下書き {drafts}件）{rows.length >= 500 && "・最大500件まで表示しています。絞り込んでください"}</p>
        <ProviderTxnTable cid={cid} rows={rows} filterJson={JSON.stringify(f)} staff={opts.staff} divisions={opts.divisions} />
      </>
    );
  });
}
