import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ContractTerms } from "@/db/schema";
import { TERM_LABELS } from "@/server/contracts";

type Opt = { id: string; name: string };
type C = { title?: string; ourSide?: string; partnerId?: string; divisionId?: string; projectId?: string | null; driverUserId?: string | null; templateId?: string; renewalNoticeDays?: number; terms?: Partial<ContractTerms> };

const LONG: (keyof ContractTerms)[] = ["scope", "renewal", "termination", "confidentiality", "deliverables", "special", "expenseBurden"];
const DATE: (keyof ContractTerms)[] = ["periodStart", "periodEnd"];
const REQ: (keyof ContractTerms)[] = ["ordererName", "contractorName", "scope", "periodStart", "periodEnd", "fee", "paymentDay"];

export function ContractFields({ c = {}, partners, divisions, projects, drivers, templates }: { c?: C; partners: Opt[]; divisions: Opt[]; projects: { id: string; code: string; name: string }[]; drivers: Opt[]; templates: { id: string; name: string; version: number }[] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="契約名" required className="sm:col-span-2"><Input name="title" defaultValue={c.title} required maxLength={200} /></Field>
        <Field label="当社の立場" required><Select name="ourSide" defaultValue={c.ourSide ?? "ORDERER"}><option value="ORDERER">発注する（委託先と結ぶ）</option><option value="CONTRACTOR">受注する（顧客と結ぶ）</option></Select></Field>
        <Field label="取引先" required><Select name="partnerId" defaultValue={c.partnerId ?? ""} required><option value="">選択</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="事業部" required><Select name="divisionId" defaultValue={c.divisionId ?? (divisions.length === 1 ? divisions[0].id : "")} required><option value="">選択</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="案件（任意）"><Select name="projectId" defaultValue={c.projectId ?? ""}><option value="">（なし）</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
        <Field label="ドライバー（業務委託契約の場合）"><Select name="driverUserId" defaultValue={c.driverUserId ?? ""}><option value="">（なし）</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="テンプレート（承認済みのみ）" required><Select name="templateId" defaultValue={c.templateId ?? ""} required><option value="">選択</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}（第{t.version}版）</option>)}</Select></Field>
        <Field label="更新の通知（終了日の何日前）"><Input name="renewalNoticeDays" inputMode="numeric" defaultValue={c.renewalNoticeDays ?? 30} /></Field>
      </div>
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-navy-900">契約条件（テンプレートに差し込まれます）</legend>
        {(Object.keys(TERM_LABELS) as (keyof ContractTerms)[]).map((k) => (
          <Field key={k} label={TERM_LABELS[k]} required={REQ.includes(k)} className={LONG.includes(k) ? "sm:col-span-2" : ""}>
            {LONG.includes(k) ? <Textarea name={`t_${k}`} defaultValue={c.terms?.[k] ?? ""} rows={2} maxLength={5000} /> : <Input name={`t_${k}`} type={DATE.includes(k) ? "date" : "text"} defaultValue={c.terms?.[k] ?? ""} maxLength={500} />}
          </Field>
        ))}
      </fieldset>
      <p className="text-xs text-muted">契約条件の内容（法的な妥当性・税務上の扱い）は、必要に応じて専門家に確認してください（要確認）。このシステムは契約の締結を自動で行いません。</p>
    </div>
  );
}
