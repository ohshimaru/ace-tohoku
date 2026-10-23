import { ActionForm } from "@/components/action-form";
import { Card, Notice } from "@/components/ui";
import { getDb } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { type Policy, POLICY_KEYS, POLICY_LABELS } from "@/lib/disclosure";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { listPolicies } from "@/server/provider-finance";
import { savePolicyAction } from "../../actions";

export const metadata = { title: "公開権限" };

function PolicyForm({ cid, subject, policy, updated }: { cid: string; subject: string; policy: Policy; updated: string }) {
  return (
    <ActionForm action={savePolicyAction} submitLabel="保存" submitVariant="secondary" className="space-y-2">
      <input type="hidden" name="companyId" value={cid} />
      <input type="hidden" name="subject" value={subject} />
      {POLICY_KEYS.map((k) => (
        <label key={k} className="flex items-start gap-2 text-sm">
          <input type="checkbox" name={k} defaultChecked={policy[k]} className="mt-1" />
          <span>
            <b>{POLICY_LABELS[k].label}</b>{POLICY_LABELS[k].risky && <span className="ml-1 text-xs font-bold text-bad">注意</span>}
            <span className="block text-xs text-muted">{POLICY_LABELS[k].hint}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-muted">{updated}</p>
    </ActionForm>
  );
}

export default async function DisclosurePage({ params }: { params: Promise<{ cid: string }> }) {
  const actor = await requireProvider();
  const { cid } = await params;
  return guard(async () => {
    const p = await listPolicies(getDb(), actor, cid);
    const upd = (x: { updatedAt: string | null; by: string | null }) => (x.updatedAt ? `最終変更: ${x.by ?? "—"}（${formatDateTime(x.updatedAt)}）` : "初期設定のまま");
    return (
      <>
        <Notice tone="warn" title="残高・集計から非公開の取引が推測されることがあります">
          明細を非公開にしても、「実際の銀行残高」や「全取引の集計」（合計・件数・月別推移・前月との差）を公開すると、公開している明細との差から非公開の取引の金額や件数を推測できる場合があります。必要な相手にだけ許可してください。初期設定では、本社・スタッフとも「公開した取引だけの集計」しか見えません。
        </Notice>
        <p className="mt-3 text-sm text-muted">ここで決めるのは、公開した明細に加えて何を見せるかです。どの取引を誰に見せるかは「入出金と公開状況」で取引ごとに設定します。本社・スタッフの利用者は、この設定を変更できません。</p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="本社（経営者・経理）">
            <PolicyForm cid={cid} subject="HQ" policy={p.hq.policy} updated={upd(p.hq)} />
          </Card>
          <Card title="スタッフ（一人ずつ）">
            {p.staff.length === 0 ? <p className="text-sm text-muted">スタッフがいません。</p> : (
              <div className="space-y-4">
                {p.staff.map((s) => (
                  <details key={s.id} className="rounded border border-line p-3">
                    <summary className="cursor-pointer text-sm font-bold">{s.name}<span className="ml-2 text-xs font-normal text-muted">{s.division}</span></summary>
                    <div className="mt-2"><PolicyForm cid={cid} subject={`STAFF:${s.id}`} policy={s.policy} updated={upd(s)} /></div>
                  </details>
                ))}
              </div>
            )}
          </Card>
        </div>
      </>
    );
  });
}
