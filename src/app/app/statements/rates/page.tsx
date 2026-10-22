import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { currentMonthJst, formatDate, todayJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDrivers } from "@/server/drivers";
import { listDivisions } from "@/server/masters";
import { projectOptions } from "@/server/partners";
import { listAdjustments, listRates } from "@/server/statements";
import { addAdjustmentAction, addRateAction, decideAdjustmentAction } from "../actions";

export const metadata = { title: "単価・調整" };

export default async function RatesPage() {
  const actor = await requireStaff();
  return guard(async () => {
    const db = getDb();
    const drvDivs = new Set((await listDivisions(db, actor)).filter((d) => d.kind === "DRIVER").map((d) => d.id));
    const [rates, adjs, projects, drivers] = await Promise.all([listRates(db, actor), listAdjustments(db, actor), projectOptions(db, actor), listDrivers(db, actor)]);
    const pj = projects.filter((p) => drvDivs.has(p.divisionId));
    const today = todayJst();
    return (
      <>
        <PageHeader title="単価・調整" back={{ href: "/app/statements", label: "稼働明細" }} description="単価は適用期間付きで管理します。新しい単価を登録すると、同じ案件・対象の直前の単価は前日で終了します。確定済みの明細に使われた期間へ遡る変更はできません。" />
        <Card title="単価">
          {rates.length === 0 ? <EmptyState title="単価が登録されていません">単価がない日報は明細に含まれません。</EmptyState> : (
            <Table>
              <thead><tr><Th>案件</Th><Th>対象</Th><Th>方式</Th><Th className="text-right">単価</Th><Th>適用期間</Th><Th /></tr></thead>
              <tbody>{rates.map(({ r, projectCode, projectName, driverName }) => {
                const current = r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today);
                return (
                  <tr key={r.id}>
                    <Td>{projectCode} {projectName}</Td>
                    <Td>{driverName ?? "全員（標準）"}</Td>
                    <Td>{L.rateMethod[r.method]}</Td>
                    <Td className="tabular text-right">{formatYen(r.unitPrice)}／{r.unitLabel}</Td>
                    <Td>{formatDate(r.effectiveFrom)}〜{r.effectiveTo ? formatDate(r.effectiveTo) : ""}</Td>
                    <Td>{current ? <Badge tone="ok">適用中</Badge> : r.effectiveFrom > today ? <Badge tone="info">予定</Badge> : <Badge>終了</Badge>}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={addRateAction} submitLabel="単価を登録" submitVariant="secondary" resetOnSuccess>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <Field label="案件" required className="col-span-2"><Select name="projectId" required><option value="">選択</option>{pj.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
                <Field label="対象ドライバー" hint="空欄=全員の標準単価"><Select name="driverId" defaultValue=""><option value="">全員（標準）</option>{drivers.map(({ u }) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
                <Field label="方式" required><Select name="method">{Object.entries(L.rateMethod).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="単価（円）" required><Input name="unitPrice" inputMode="numeric" required /></Field>
                <Field label="適用開始日" required><Input type="date" name="effectiveFrom" defaultValue={today} required /></Field>
              </div>
            </ActionForm>
          </div>
        </Card>
        <Card title="加算・調整（承認制）" className="mt-6">
          {adjs.length === 0 ? <EmptyState title="調整はありません" /> : (
            <Table>
              <thead><tr><Th>対象月</Th><Th>ドライバー</Th><Th className="text-right">金額</Th><Th>理由</Th><Th>状態</Th><Th /></tr></thead>
              <tbody>{adjs.map(({ a, driverName }) => (
                <tr key={a.id}>
                  <Td>{a.month}</Td><Td>{driverName}</Td><Td className="tabular text-right">{formatYen(a.amount)}</Td><Td>{a.reason}</Td>
                  <Td><Badge tone={L.request[a.status][1]}>{L.request[a.status][0]}</Badge></Td>
                  <Td>{a.status === "PENDING" && a.createdById !== actor.userId && (
                    <div className="flex gap-2">
                      <ActionForm action={decideAdjustmentAction} inline submitLabel="承認" submitVariant="secondary"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                      <ActionForm action={decideAdjustmentAction} inline submitLabel="却下" submitVariant="ghost"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="reject" /></ActionForm>
                    </div>
                  )}{a.status === "PENDING" && a.createdById === actor.userId && <span className="text-xs text-muted">別の担当者の承認待ち</span>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={addAdjustmentAction} submitLabel="調整を登録" submitVariant="secondary" resetOnSuccess>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label="ドライバー" required><Select name="driverId" required><option value="">選択</option>{drivers.map(({ u }) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
                <Field label="対象月" required><Input type="month" name="month" defaultValue={currentMonthJst()} required /></Field>
                <Field label="案件（任意）"><Select name="projectId" defaultValue=""><option value="">（なし）</option>{pj.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>
                <Field label="金額（マイナス可）" required><Input name="amount" required /></Field>
                <Field label="理由" required><Input name="reason" required maxLength={300} /></Field>
              </div>
            </ActionForm>
          </div>
        </Card>
      </>
    );
  });
}
