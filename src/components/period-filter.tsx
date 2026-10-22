import { Field, FilterBar, Input, Select } from "./ui";

export function PeriodFilter({ from, to, divisionId, divisions, extra }: { from: string; to: string; divisionId?: string; divisions: { id: string; name: string }[]; extra?: React.ReactNode }) {
  return (
    <FilterBar>
      <Field label="期間（から）"><Input type="month" name="from" defaultValue={from} /></Field>
      <Field label="期間（まで）"><Input type="month" name="to" defaultValue={to} /></Field>
      <Field label="表示">
        <Select name="division" defaultValue={divisionId ?? ""}>
          {divisions.length > 1 && <option value="">会社全体</option>}
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      {extra}
    </FilterBar>
  );
}
