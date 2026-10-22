import { Field, Input, Select, Textarea } from "@/components/ui";

type P = { type?: string; name?: string; nameKana?: string | null; postalCode?: string | null; address?: string | null; phone?: string | null; email?: string | null; contactName?: string | null; billingInfo?: string | null; isCustomer?: boolean; isContractor?: boolean };

export function PartnerFields({ p = {}, divisions, divisionIds = [] }: { p?: P; divisions: { id: string; name: string }[]; divisionIds?: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="区分" required><Select name="type" defaultValue={p.type ?? "CORPORATION"}><option value="CORPORATION">法人</option><option value="INDIVIDUAL">個人</option></Select></Field>
      <Field label="名称" required className="lg:col-span-2"><Input name="name" defaultValue={p.name ?? ""} required maxLength={200} /></Field>
      <Field label="フリガナ"><Input name="nameKana" defaultValue={p.nameKana ?? ""} /></Field>
      <Field label="郵便番号"><Input name="postalCode" defaultValue={p.postalCode ?? ""} inputMode="numeric" /></Field>
      <Field label="住所" className="lg:col-span-3"><Input name="address" defaultValue={p.address ?? ""} /></Field>
      <Field label="担当者"><Input name="contactName" defaultValue={p.contactName ?? ""} /></Field>
      <Field label="電話"><Input name="phone" defaultValue={p.phone ?? ""} inputMode="tel" /></Field>
      <Field label="メール" className="lg:col-span-2"><Input type="email" name="email" defaultValue={p.email ?? ""} /></Field>
      <Field label="請求情報（宛名・締日・送付方法など）" className="sm:col-span-2 lg:col-span-4"><Textarea name="billingInfo" defaultValue={p.billingInfo ?? ""} rows={2} /></Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-bold text-navy-800">役割（両方選べます）</legend>
        <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="isCustomer" value="1" defaultChecked={p.isCustomer ?? true} className="h-4 w-4" /> 顧客（売上の相手）</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="isContractor" value="1" defaultChecked={p.isContractor ?? false} className="h-4 w-4" /> 業務委託先（支払の相手）</label>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-bold text-navy-800">所属事業部</legend>
        {divisions.map((d) => <label key={d.id} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="divisionIds" value={d.id} defaultChecked={divisionIds.includes(d.id) || divisions.length === 1} className="h-4 w-4" /> {d.name}</label>)}
      </fieldset>
    </div>
  );
}
