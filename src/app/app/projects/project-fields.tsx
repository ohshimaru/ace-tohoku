import { Field, Input, Select } from "@/components/ui";
import { L } from "@/lib/labels";
import type { ReportFieldConfig } from "@/db/schema";

type Opt = { id: string; name: string };
type P = { code?: string; name?: string; divisionId?: string; customerId?: string | null; category?: string; contractType?: string; amount?: number; startDate?: string | null; endDate?: string | null; dueDate?: string | null; status?: string; reportFields?: ReportFieldConfig };

export function ProjectFields({ p = {}, divisions, customers }: { p?: P; divisions: Opt[]; customers: Opt[] }) {
  const rf = p.reportFields ?? { quantity: false, quantityUnit: "件", distance: false, breakTime: true, attachments: true };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="案件コード" required hint="英数字・ハイフン"><Input name="code" defaultValue={p.code ?? ""} required pattern="[A-Za-z0-9_\-]+" /></Field>
      <Field label="案件名" required className="lg:col-span-2"><Input name="name" defaultValue={p.name ?? ""} required /></Field>
      <Field label="事業部" required><Select name="divisionId" defaultValue={p.divisionId ?? (divisions.length === 1 ? divisions[0].id : "")} required><option value="">選択</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="顧客"><Select name="customerId" defaultValue={p.customerId ?? ""}><option value="">（なし）</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="案件区分" hint="例: SNS運用 / AI開発 / 配送 / 定期清掃"><Input name="category" defaultValue={p.category ?? ""} list="project-categories" /></Field>
      <datalist id="project-categories"><option value="SNS運用" /><option value="AI開発" /><option value="配送" /><option value="定期清掃" /><option value="スポット清掃" /></datalist>
      <Field label="契約形態" required><Select name="contractType" defaultValue={p.contractType ?? "ONE_OFF"}>{Object.entries(L.contractType).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="契約金額（税抜）" hint="月額契約は月額"><Input name="amount" defaultValue={p.amount ?? 0} inputMode="numeric" /></Field>
      <Field label="開始日"><Input type="date" name="startDate" defaultValue={p.startDate ?? ""} /></Field>
      <Field label="終了日"><Input type="date" name="endDate" defaultValue={p.endDate ?? ""} /></Field>
      <Field label="納期"><Input type="date" name="dueDate" defaultValue={p.dueDate ?? ""} /></Field>
      <Field label="状態"><Select name="status" defaultValue={p.status ?? "ACTIVE"}>{Object.entries(L.projectStatus).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <fieldset className="sm:col-span-2 lg:col-span-4">
        <legend className="mb-1 text-xs font-bold text-navy-800">ドライバーの日報で入力する項目（不要な項目は非表示）</legend>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2"><input type="checkbox" name="rfQuantity" value="1" defaultChecked={rf.quantity} className="h-4 w-4" /> 実績数量</label>
          <label className="inline-flex items-center gap-2">単位 <Input name="rfQuantityUnit" defaultValue={rf.quantityUnit} className="w-20" /></label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" name="rfDistance" value="1" defaultChecked={rf.distance} className="h-4 w-4" /> 走行距離</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" name="rfBreakTime" value="1" defaultChecked={rf.breakTime} className="h-4 w-4" /> 休憩</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" name="rfAttachments" value="1" defaultChecked={rf.attachments} className="h-4 w-4" /> 添付ファイル</label>
        </div>
      </fieldset>
    </div>
  );
}
