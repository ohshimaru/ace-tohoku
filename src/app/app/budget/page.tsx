import { ActionForm } from "@/components/action-form";
import { Bar } from "@/components/metric";
import { Badge, Card, EmptyState, Field, FilterBar, Input, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can, isCompanyWide } from "@/lib/access";
import { currentMonthJst, formatDate, MONTH_RE, todayJst } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listBudgetRequests, listBudgetStatus, listCommitments, listRules } from "@/server/budget";
import { listCategories, listDivisions } from "@/server/masters";
import { projectOptions } from "@/server/partners";
import { addCommitmentAction, archiveRuleAction, cancelCommitmentAction, requestBudgetAction, saveRuleAction } from "./actions";

export const metadata = { title: "予算" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ month?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonthJst();
    const [envs, rules, commitments, requests, divisions, categories, projects] = await Promise.all([
      listBudgetStatus(db, actor, month), listRules(db, actor), listCommitments(db, actor), listBudgetRequests(db, actor), listDivisions(db, actor), listCategories(db), projectOptions(db, actor),
    ]);
    const shown = envs.filter((e) => !sp.division || e.rule.divisionId === sp.division);
    return (
      <>
        <PageHeader title="予算" description="社内ルール上使える予算です。銀行残高に基づく資金余力とは別の指標です。予算は税込の支出額で管理します。" />
        <FilterBar>
          <Field label="対象月"><Input type="month" name="month" defaultValue={month} /></Field>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </FilterBar>
        <Notice tone="info">利用可能額 = 予算上限 − 使用済み（承認済み経費） − 予約済み（申請中の経費・発注済み費用）。申請中の経費は承認されると予約から使用済みへ移り、二重には引かれません。差戻し・却下・取消で予約から外れます。</Notice>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shown.length === 0 && <Card><EmptyState title="この月に適用される予算ルールはありません">{can.editBudgetRules(actor) ? "下のフォームでルールを追加できます。" : "経営者・会社管理者が設定します。"}</EmptyState></Card>}
          {shown.map((e) => (
            <Card key={e.rule.id} title={e.scopeLabel} actions={<span className="flex gap-1"><Badge>{e.periodLabel}</Badge><Badge tone={e.rule.overAction === "BLOCK" ? "bad" : "warn"}>超過時: {e.rule.overAction === "BLOCK" ? "申請制限" : "警告"}</Badge></span>}>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><p className="text-xs text-muted">上限</p><p className="tabular font-bold">{formatYen(e.cap)}</p></div>
                <div><p className="text-xs text-muted">使用済み</p><p className="tabular font-bold">{formatYen(e.used)}</p></div>
                <div><p className="text-xs text-muted">予約済み</p><p className="tabular font-bold">{formatYen(e.reserved)}</p></div>
                <div><p className="text-xs text-muted">利用可能額</p><p className={`tabular font-bold ${e.available < 0 ? "text-bad" : "text-ok"}`}>{formatYen(e.available)}</p></div>
              </div>
              <div className="mt-2"><Bar value={e.used + e.reserved} max={e.cap} tone={e.available < 0 ? "bad" : (e.consumptionRate ?? 0) > 0.8 ? "warn" : "navy"} /></div>
              <p className="mt-1 text-xs text-muted">消化率 {e.consumptionRate === null ? "—" : `${Math.round(e.consumptionRate * 1000) / 10}%`}{e.forecast !== null && `／月末見込み ${formatYen(e.forecast)}${e.forecast > e.cap ? "（超過見込み）" : ""}`}</p>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-navy-700">計算根拠（ルール「{e.rule.name}」優先順位 {e.rule.priority}）</summary>
                <table className="mt-2 w-full text-xs"><tbody>
                  {e.basis.map((b) => <tr key={b.label} className="border-b border-line"><td className="py-1">{b.label}{b.note && <span className="text-muted">（{b.note}）</span>}</td><td className="tabular py-1 text-right">{formatYen(b.amount)}</td></tr>)}
                  <tr className="font-bold"><td className="py-1">利用可能額</td><td className="tabular py-1 text-right">{formatYen(e.available)}</td></tr>
                </tbody></table>
              </details>
            </Card>
          ))}
        </div>

        <Card title="予算追加申請" className="mt-6">
          <ActionForm action={requestBudgetAction} submitLabel="申請する" resetOnSuccess>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="事業部" required><Select name="divisionId" required>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
              <Field label="費目"><Select name="categoryId"><option value="">全費目</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label="対象月" required><Input type="month" name="month" defaultValue={month} required /></Field>
              <Field label="追加額（円）" required><Input name="amount" inputMode="numeric" required /></Field>
              <Field label="理由" required className="sm:col-span-4"><Input name="reason" required maxLength={1000} /></Field>
            </div>
          </ActionForm>
          {requests.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {requests.slice(0, 10).map(({ r, divisionName }) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{divisionName} {r.month} {formatYen(r.amount)}：{r.reason}</span><Badge tone={L.request[r.status][1]}>{L.request[r.status][0]}</Badge></li>)}
            </ul>
          )}
        </Card>

        <Card title="発注済み費用（予約額に含める）" className="mt-6">
          {commitments.length === 0 ? <p className="text-sm text-muted">未消化の発注はありません。</p> : (
            <Table>
              <thead><tr><Th>発注日</Th><Th>事業部・費目</Th><Th>内容</Th><Th className="text-right">金額</Th><Th /></tr></thead>
              <tbody>{commitments.map(({ c, divisionName, categoryName }) => (
                <tr key={c.id}><Td>{formatDate(c.orderedOn)}</Td><Td>{divisionName}<div className="text-xs text-muted">{categoryName}</div></Td><Td>{c.description}</Td><Td className="tabular text-right">{formatYen(c.amount)}</Td>
                  <Td className="text-right"><ActionForm action={cancelCommitmentAction} inline submitLabel="取消" submitVariant="danger" confirm="この発注を取消して予約額から外しますか？"><input type="hidden" name="id" value={c.id} /></ActionForm></Td></tr>
              ))}</tbody>
            </Table>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={addCommitmentAction} submitLabel="発注を登録" submitVariant="secondary" resetOnSuccess>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="事業部" required><Select name="divisionId" required>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                <Field label="費目" required><Select name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                <Field label="案件"><Select name="projectId"><option value="">（なし）</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>
                <Field label="内容" required><Input name="description" required /></Field>
                <Field label="金額（税込）" required><Input name="amount" inputMode="numeric" required /></Field>
                <Field label="発注日" required><Input type="date" name="orderedOn" defaultValue={todayJst()} required /></Field>
              </div>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">実際の経費を申請するときに、この発注を選んで紐付けてください。経費が承認されると発注は消化済みになり、予約額から外れます。</p>
          </div>
        </Card>

        <Card title="予算ルール" className="mt-6">
          {rules.length === 0 ? <p className="text-sm text-muted">ルールはありません。</p> : (
            <Table>
              <thead><tr><Th>ルール</Th><Th>対象</Th><Th>期間</Th><Th className="text-right">固定上限</Th><Th>連動</Th><Th>適用</Th><Th>超過時</Th><Th className="text-right">優先</Th>{can.editBudgetRules(actor) && <Th />}</tr></thead>
              <tbody>{rules.map(({ rule: r, divisionName, categoryName }) => (
                <tr key={r.id}>
                  <Td>{r.name}{r.carryOver && <div><Badge>繰越あり</Badge></div>}</Td>
                  <Td>{divisionName ?? "共通経費"}<div className="text-xs text-muted">{categoryName ?? "全費目"}{r.userId ? "・個人枠" : ""}</div></Td>
                  <Td>{r.period === "MONTH" ? "月間" : "年間（会計年度）"}</Td>
                  <Td className="tabular text-right">{formatYen(r.fixedAmount)}</Td>
                  <Td className="text-xs">{r.perHeadAmount ? `1人 ${formatYen(r.perHeadAmount)}` : ""}{r.base !== "NONE" ? ` ${r.base === "SALES" ? "売上" : "利益"}×${r.baseRatioBp / 100}%（${r.baseWindow === "PREV" ? "前期間" : "同期間"}）` : ""}{!r.perHeadAmount && r.base === "NONE" ? "—" : ""}</Td>
                  <Td className="text-xs">{formatDate(r.effectiveFrom)}〜{r.effectiveTo ? formatDate(r.effectiveTo) : ""}</Td>
                  <Td>{r.overAction === "BLOCK" ? "申請制限" : "警告"}</Td>
                  <Td className="tabular text-right">{r.priority}</Td>
                  {can.editBudgetRules(actor) && <Td><ActionForm action={archiveRuleAction} inline submitLabel="終了" submitVariant="danger" confirm="このルールを終了しますか？"><input type="hidden" name="id" value={r.id} /></ActionForm></Td>}
                </tr>
              ))}</tbody>
            </Table>
          )}
          {can.editBudgetRules(actor) ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-bold">ルールを追加</h3>
              <ActionForm action={saveRuleAction} submitLabel="ルールを保存" resetOnSuccess>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <Field label="ルール名" required><Input name="name" required /></Field>
                  <Field label="対象事業部"><Select name="divisionId"><option value="">共通経費（全社）</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                  <Field label="対象費目"><Select name="categoryId"><option value="">全費目</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                  <Field label="期間"><Select name="period"><option value="MONTH">月間</option><option value="YEAR">年間（会計年度）</option></Select></Field>
                  <Field label="固定上限（円）"><Input name="fixedAmount" defaultValue="0" inputMode="numeric" /></Field>
                  <Field label="1人あたり額（円）"><Input name="perHeadAmount" defaultValue="0" inputMode="numeric" /></Field>
                  <Field label="人数の数え方"><Select name="headcountBasis"><option value="DIVISION_DRIVERS">稼働中のドライバー数</option><option value="DIVISION_USERS">事業部の担当者数</option></Select></Field>
                  <Field label="売上・利益に連動"><Select name="base"><option value="NONE">連動しない</option><option value="SALES">売上の割合</option><option value="PROFIT">利益の割合</option></Select></Field>
                  <Field label="割合（%）"><Input name="basePercent" defaultValue="0" inputMode="decimal" /></Field>
                  <Field label="連動の基準"><Select name="baseWindow"><option value="PREV">前期間の実績</option><option value="SAME">同期間の実績</option></Select></Field>
                  <Field label="適用開始日" required><Input type="date" name="effectiveFrom" defaultValue={`${month}-01`} required /></Field>
                  <Field label="適用終了日"><Input type="date" name="effectiveTo" /></Field>
                  <Field label="超過時"><Select name="overAction"><option value="WARN">警告のみ</option><option value="BLOCK">申請制限（例外承認が必要）</option></Select></Field>
                  <Field label="優先順位" hint="同じ対象のルールが重なると大きい方を使う"><Input name="priority" defaultValue="0" inputMode="numeric" /></Field>
                  <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="carryOver" value="1" className="h-4 w-4" /> 前月の残額を繰り越す（月間のみ）</label>
                </div>
              </ActionForm>
            </div>
          ) : <p className="mt-2 text-xs text-muted">ルールの追加・変更は経営者・会社管理者が行います。{isCompanyWide(actor) ? "" : "担当事業部のルールだけ表示しています。"}</p>}
        </Card>
      </>
    );
  });
}
