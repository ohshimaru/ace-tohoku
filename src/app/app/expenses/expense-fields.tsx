import { Field, Input, Select, Textarea } from "@/components/ui";
import { todayJst } from "@/lib/dates";

type Opt = { id: string; name: string };
type E = { usedOn?: string; divisionId?: string | null; projectId?: string | null; categoryId?: string; payee?: string; purpose?: string; amount?: number; taxRate?: number; settlement?: string; commitmentId?: string | null };

export function ExpenseFields({
  e = {},
  divisions,
  categories,
  projects,
  commitments = [],
  allowCommon,
  driver = false,
}: {
  e?: E;
  divisions: Opt[];
  categories: Opt[];
  projects: { id: string; code: string; name: string }[];
  commitments?: { id: string; label: string }[];
  allowCommon: boolean;
  driver?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="利用日" required><Input type="date" name="usedOn" defaultValue={e.usedOn ?? todayJst()} max={todayJst()} required /></Field>
      {driver ? (
        <input type="hidden" name="divisionId" value={e.divisionId ?? divisions[0]?.id ?? ""} />
      ) : (
        <Field label="事業部" required hint={allowCommon ? "全社の家賃などは「共通経費」" : undefined}>
          <Select name="divisionId" defaultValue={e.divisionId === null ? "COMMON" : (e.divisionId ?? (divisions.length === 1 ? divisions[0].id : ""))} required>
            <option value="">選択</option>
            {allowCommon && <option value="COMMON">共通経費（全社）</option>}
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="案件"><Select name="projectId" defaultValue={e.projectId ?? ""}><option value="">（なし）</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
      <Field label="費目" required><Select name="categoryId" defaultValue={e.categoryId ?? ""} required><option value="">選択</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="金額（税込・円）" required><Input name="amount" defaultValue={e.amount ?? ""} inputMode="numeric" required /></Field>
      <Field label="税区分" required><Select name="taxRate" defaultValue={String(e.taxRate ?? 10)}><option value="10">課税 10%</option><option value="8">課税 8%（軽減）</option><option value="0">対象外・非課税</option></Select></Field>
      <Field label="支払先" required><Input name="payee" defaultValue={e.payee ?? ""} required maxLength={200} /></Field>
      <Field label="精算方法" required>
        <Select name="settlement" defaultValue={e.settlement ?? (driver ? "STATEMENT" : "SEPARATE")}>
          {driver ? <><option value="STATEMENT">稼働明細に含めて精算</option><option value="SEPARATE">別に支払ってもらう</option></> : <><option value="SEPARATE">立替えた（別払いで精算）</option><option value="COMPANY_PAID">会社が直接支払う</option></>}
        </Select>
      </Field>
      <Field label="用途" required className="sm:col-span-2 lg:col-span-4"><Textarea name="purpose" defaultValue={e.purpose ?? ""} required maxLength={1000} rows={2} /></Field>
      {commitments.length > 0 && (
        <Field label="発注済み費用に紐付ける" className="sm:col-span-2" hint="承認されると発注は「消化済み」になり、予約額から外れます"><Select name="commitmentId" defaultValue={e.commitmentId ?? ""}><option value="">（紐付けない）</option>{commitments.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
      )}
    </div>
  );
}
