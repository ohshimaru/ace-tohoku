import { FinanceView } from "@/components/finance-view";
import { Card, Field, FilterBar, Notice, Select } from "@/components/ui";
import { getDb } from "@/db";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { hiddenSummary, listVisibleTxns, previewViewer, summarize, visibleAccounts } from "@/server/finance-visibility";
import { audienceOptions } from "@/server/provider-finance";

export const metadata = { title: "見え方の確認" };

/** 本社・特定スタッフにどう見えるか。実際の閲覧と同じ判定（previewViewer → listVisibleTxns / summarize）を使う */
export default async function PreviewPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<{ as?: string }> }) {
  const actor = await requireProvider();
  const { cid } = await params;
  const as = (await searchParams).as || "HQ";
  return guard(async () => {
    const db = getDb();
    const opts = await audienceOptions(db, actor, cid);
    const viewer = await previewViewer(db, actor, cid, as);
    const [summary, hidden, accounts] = await Promise.all([summarize(db, viewer, {}), hiddenSummary(db, actor, viewer), visibleAccounts(db, viewer)]);
    const txns = summary.policy.viewDetails ? await listVisibleTxns(db, viewer, {}, 200) : null;
    const who = as === "HQ" ? "本社（経営者・経理）" : opts.staff.find((s) => s.id === as)?.name ?? "スタッフ";
    return (
      <>
        <FilterBar>
          <Field label="誰として見るか">
            <Select name="as" defaultValue={as}>
              <option value="HQ">本社（経営者・経理）</option>
              {opts.staff.map((s) => <option key={s.id} value={s.id}>スタッフ: {s.name}{s.division ? `（${s.division}）` : ""}</option>)}
            </Select>
          </Field>
        </FilterBar>
        <Card title={`${who}に表示されないもの`} className="mb-4">
          <ul className="list-disc space-y-1 pl-5 text-sm">{hidden.notShown.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="mt-2 text-xs text-muted">この会社の取引 {hidden.total}件のうち、{who}に表示されるのは {hidden.visible}件です。CSV出力: {hidden.policy.canExport ? "できる" : "できない"}。</p>
        </Card>
        <Notice tone="info" title={`ここから下は「${who}」の画面と同じ内容です`}>実際の閲覧と同じ処理で作っています（リンクと出力ボタンは表示していません）。</Notice>
        <div className="mt-4 rounded-lg border-2 border-dashed border-navy-200 p-3">
          <FinanceView summary={summary} txns={txns} filter={{}} accounts={accounts} showFilter={false} />
        </div>
      </>
    );
  });
}
