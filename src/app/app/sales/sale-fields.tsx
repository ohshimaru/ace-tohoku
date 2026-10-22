import { Field, Input, Select } from "@/components/ui";
import { todayJst } from "@/lib/dates";

type Opt = { id: string; name: string };
type P = { id: string; code: string; name: string; divisionId: string };
type S = { recognizedOn?: string; divisionId?: string; customerId?: string | null; projectId?: string | null; description?: string; amountExTax?: number; taxRate?: number; billingStatus?: string; expectedReceiptDate?: string | null };

export function SaleFields({ s = {}, divisions, customers, projects }: { s?: S; divisions: Opt[]; customers: Opt[]; projects: P[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="計上日" required hint="計上月はこの日付の月になります"><Input type="date" name="recognizedOn" defaultValue={s.recognizedOn ?? todayJst()} required /></Field>
      <Field label="事業部" required>
        <Select name="divisionId" defaultValue={s.divisionId ?? (divisions.length === 1 ? divisions[0].id : "")} required>
          <option value="">選択</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="案件"><Select name="projectId" defaultValue={s.projectId ?? ""}><option value="">（なし）</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
      <Field label="顧客" hint="案件を選ぶと案件の顧客が入ります"><Select name="customerId" defaultValue={s.customerId ?? ""}><option value="">（案件の顧客）</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="内容" required className="sm:col-span-2"><Input name="description" defaultValue={s.description ?? ""} required maxLength={200} /></Field>
      <Field label="売上金額（税抜・円）" required><Input name="amountExTax" defaultValue={s.amountExTax ?? ""} inputMode="numeric" required /></Field>
      <Field label="税区分" required>
        <Select name="taxRate" defaultValue={String(s.taxRate ?? 10)}><option value="10">課税 10%</option><option value="8">課税 8%（軽減）</option><option value="0">対象外・非課税</option></Select>
      </Field>
      <Field label="請求状況"><Select name="billingStatus" defaultValue={s.billingStatus ?? "UNBILLED"}><option value="UNBILLED">未請求</option><option value="BILLED">請求済み</option><option value="NOT_REQUIRED">請求不要</option></Select></Field>
      <Field label="入金予定日"><Input type="date" name="expectedReceiptDate" defaultValue={s.expectedReceiptDate ?? ""} /></Field>
    </div>
  );
}
