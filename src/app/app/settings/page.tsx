import { ActionForm } from "@/components/action-form";
import { ConnBadge } from "@/components/conn-badge";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can, ROLE_LABELS } from "@/lib/access";
import { addMonths, currentMonthJst } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { connectionStatus } from "@/server/integrations";
import { getSettings, listCategories, listDivisions, listStaff } from "@/server/masters";
import { listAllocationRules } from "@/server/metrics";
import { archiveDivisionAction, createStaffAction, endAllocationAction, saveAllocationAction, saveCategoryAction, saveDivisionAction, updateSettingsAction, updateStaffAction } from "./actions";

export const metadata = { title: "設定" };

export default async function SettingsPage() {
  const actor = await requireStaff();
  return guard(async () => {
    if (!can.administer(actor)) throw forbidden("設定は経営者・会社管理者のみ変更できます");
    const db = getDb();
    const [s, divisions, allDivisions, categories, staff, allocs, conns] = await Promise.all([getSettings(db), listDivisions(db), listDivisions(db, undefined, { includeArchived: true }), listCategories(db), listStaff(db, actor), listAllocationRules(db), connectionStatus(db)]);
    return (
      <>
        <PageHeader title="設定" />
        <Card title="会社・会計の設定">
          <ActionForm action={updateSettingsAction} submitLabel="保存する">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="会社名" required><Input name="companyName" defaultValue={s.companyName} required /></Field>
              <Field label="アプリ名" required><Input name="appName" defaultValue={s.appName} required /></Field>
              <Field label="会計年度の開始月" required><Select name="fiscalYearStartMonth" defaultValue={String(s.fiscalYearStartMonth)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}月</option>)}</Select></Field>
              <Field label="消費税の端数処理"><Select name="taxRounding" defaultValue={s.taxRounding}><option value="FLOOR">切り捨て</option><option value="ROUND">四捨五入</option><option value="CEIL">切り上げ</option></Select></Field>
              <Field label="住所（帳票に表示）" className="lg:col-span-2"><Input name="issuerAddress" defaultValue={s.issuerAddress} /></Field>
              <Field label="適格請求書の登録番号"><Input name="registrationNumber" defaultValue={s.registrationNumber} placeholder="T1234567890123" /></Field>
              <Field label="稼働明細の支払日（翌月）" hint="31=月末"><Input name="statementPayDay" defaultValue={s.statementPayDay} inputMode="numeric" /></Field>
              <Field label="資金余力の計算期間（日）"><Input name="cashHorizonDays" defaultValue={s.cashHorizonDays} inputMode="numeric" /></Field>
              <Field label="資金余力の警告基準（円）"><Input name="cashWarningThreshold" defaultValue={s.cashWarningThreshold} inputMode="numeric" /></Field>
              <Field label="外注費率の警告基準（%）" hint="事業部ごとに上書き可"><Input name="outsourcingRatioLimit" defaultValue={s.outsourcingRatioLimit} inputMode="numeric" /></Field>
              <Field label="Clean Up のURL" hint="例: https://cleanup-genba.com/c/会社の識別名/admin"><Input name="cleanupUrl" defaultValue={s.cleanupUrl} placeholder="https://" /></Field>
              <fieldset className="sm:col-span-2 lg:col-span-4">
                <legend className="mb-1 text-xs font-bold text-navy-800">予算の予約額に含めるもの</legend>
                <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="reserveSubmittedExpenses" value="1" defaultChecked={s.reserveSubmittedExpenses} className="h-4 w-4" /> 申請中の経費</label>
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="reserveCommitments" value="1" defaultChecked={s.reserveCommitments} className="h-4 w-4" /> 発注済み費用</label>
              </fieldset>
            </div>
          </ActionForm>
        </Card>

        <Card title="事業部" className="mt-4">
          <Table>
            <thead><tr><Th>コード</Th><Th>名称</Th><Th>種類</Th><Th>外注費率基準</Th><Th>状態</Th><Th /></tr></thead>
            <tbody>{allDivisions.map((d) => (
              <tr key={d.id}>
                <Td className="font-mono text-xs">{d.code}</Td><Td>{d.name}</Td><Td>{L.divisionKind[d.kind]}</Td><Td>{d.outsourcingRatioLimit ? `${d.outsourcingRatioLimit}%` : "全社の基準"}</Td>
                <Td>{d.archivedAt ? <Badge>無効</Badge> : <Badge tone="ok">有効</Badge>}</Td>
                <Td><details><summary className="cursor-pointer text-xs text-navy-700">編集</summary>
                  <div className="mt-2 space-y-2">
                    <ActionForm action={saveDivisionAction} submitLabel="保存" submitVariant="secondary">
                      <input type="hidden" name="id" value={d.id} />
                      <div className="grid grid-cols-2 gap-2"><Input name="code" defaultValue={d.code} required /><Input name="name" defaultValue={d.name} required /><Select name="kind" defaultValue={d.kind}>{Object.entries(L.divisionKind).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select><Input name="outsourcingRatioLimit" defaultValue={d.outsourcingRatioLimit ?? ""} placeholder="外注費率基準%" /><Input name="sortOrder" defaultValue={d.sortOrder} placeholder="並び順" /></div>
                    </ActionForm>
                    <ActionForm action={archiveDivisionAction} inline submitLabel={d.archivedAt ? "有効に戻す" : "無効にする"} submitVariant="danger"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="archived" value={d.archivedAt ? "0" : "1"} /></ActionForm>
                  </div>
                </details></Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={saveDivisionAction} submitLabel="事業部を追加" submitVariant="secondary" resetOnSuccess>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <Field label="コード" required><Input name="code" required /></Field>
                <Field label="名称" required><Input name="name" required /></Field>
                <Field label="種類"><Select name="kind">{Object.entries(L.divisionKind).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                <Field label="外注費率基準（%）"><Input name="outsourcingRatioLimit" /></Field>
                <Field label="並び順"><Input name="sortOrder" defaultValue="0" /></Field>
              </div>
            </ActionForm>
          </div>
        </Card>

        <Card title="費目" className="mt-4">
          <ul className="flex flex-wrap gap-2 text-sm">{categories.map((c) => <li key={c.id} className="rounded border border-line px-2 py-1">{c.name}{c.isOutsourcing && <span className="ml-1"><Badge tone="info">外注費</Badge></span>}</li>)}</ul>
          <div className="mt-3"><ActionForm action={saveCategoryAction} inline submitLabel="費目を追加" submitVariant="secondary" resetOnSuccess>
            <Field label="費目名"><Input name="name" required /></Field>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="isOutsourcing" value="1" className="h-4 w-4" /> 外注費として扱う</label>
            <input type="hidden" name="sortOrder" value="100" />
          </ActionForm></div>
        </Card>

        <Card title="共通経費の配賦ルール" className="mt-4">
          {allocs.length === 0 ? <p className="text-sm text-muted">配賦ルールがないため、共通経費は「未配賦」として全社にだけ表示されます。</p> : (
            <Table>
              <thead><tr><Th>名称</Th><Th>方法</Th><Th>割合</Th><Th>適用</Th><Th>優先</Th><Th /></tr></thead>
              <tbody>{allocs.map((r) => (
                <tr key={r.id}><Td>{r.name}{r.categoryId && <div className="text-xs text-muted">{categories.find((c) => c.id === r.categoryId)?.name}</div>}</Td><Td>{r.method === "FIXED_RATIO" ? "固定割合" : r.method === "SALES_RATIO" ? "売上比" : "配賦しない"}</Td>
                  <Td className="text-xs">{r.shares.map((s) => `${divisions.find((d) => d.id === s.divisionId)?.name ?? "?"} ${s.ratioBp / 100}%`).join("、") || "—"}</Td>
                  <Td className="text-xs">{r.effectiveFrom}〜{r.effectiveTo ?? ""}</Td><Td>{r.priority}</Td>
                  <Td>{!r.effectiveTo && <ActionForm action={endAllocationAction} inline submitLabel="終了" submitVariant="secondary"><input type="hidden" name="id" value={r.id} /><Input type="month" name="month" defaultValue={currentMonthJst()} className="w-36" /></ActionForm>}</Td></tr>
              ))}</tbody>
            </Table>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={saveAllocationAction} submitLabel="配賦ルールを追加" submitVariant="secondary" resetOnSuccess>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="名称" required><Input name="name" required /></Field>
                <Field label="方法"><Select name="method"><option value="SALES_RATIO">売上比</option><option value="FIXED_RATIO">固定割合</option><option value="NONE">配賦しない</option></Select></Field>
                <Field label="対象費目"><Select name="categoryId"><option value="">すべての共通経費</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                <Field label="適用開始月" required><Input type="month" name="effectiveFrom" defaultValue={addMonths(currentMonthJst(), 0)} required /></Field>
                <Field label="終了月"><Input type="month" name="effectiveTo" /></Field>
                <Field label="優先順位"><Input name="priority" defaultValue="0" /></Field>
              </div>
              <fieldset className="mt-2 flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-xs font-bold text-navy-800">固定割合のときの割合（%）</legend>{divisions.map((d) => <label key={d.id} className="inline-flex items-center gap-1">{d.name}<Input name={`share_${d.id}`} className="w-20" inputMode="decimal" /></label>)}</fieldset>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">固定割合の合計が100%未満の場合、残りは「未配賦」として全社にだけ表示されます。どの方法でも、全社の利益では共通経費を1回だけ引きます。</p>
          </div>
        </Card>

        <Card title="会社側の利用者" className="mt-4">
          <Table>
            <thead><tr><Th>氏名・メール</Th><Th>権限</Th><Th>担当事業部</Th><Th>状態</Th><Th /></tr></thead>
            <tbody>{staff.map((u) => (
              <tr key={u.id}>
                <Td>{u.name}<div className="text-xs text-muted">{u.email}</div></Td><Td>{ROLE_LABELS[u.role]}</Td>
                <Td className="text-xs">{u.divisionIds.map((id) => divisions.find((d) => d.id === id)?.name).join("・") || (u.role === "MANAGER" ? "—" : "全事業部")}</Td>
                <Td><Badge tone={L.userStatus[u.status][1]}>{L.userStatus[u.status][0]}</Badge></Td>
                <Td><details><summary className="cursor-pointer text-xs text-navy-700">変更</summary><div className="mt-2">
                  <ActionForm action={updateStaffAction} submitLabel="保存" submitVariant="secondary">
                    <input type="hidden" name="id" value={u.id} />
                    <div className="grid grid-cols-2 gap-2"><Select name="role" defaultValue={u.role}><option value="OWNER">経営者・会社管理者</option><option value="ACCOUNTING">経理</option><option value="MANAGER">事業部責任者</option></Select><Select name="status" defaultValue={u.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE"}><option value="ACTIVE">利用中</option><option value="SUSPENDED">停止</option></Select></div>
                    <div className="flex flex-wrap gap-2 text-xs">{divisions.map((d) => <label key={d.id} className="inline-flex items-center gap-1"><input type="checkbox" name="divisionIds" value={d.id} defaultChecked={u.divisionIds.includes(d.id)} />{d.name}</label>)}</div>
                  </ActionForm>
                </div></details></Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={createStaffAction} submitLabel="利用者を追加" submitVariant="secondary" resetOnSuccess>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Field label="氏名" required><Input name="name" required /></Field>
                <Field label="メール" required><Input type="email" name="email" required /></Field>
                <Field label="権限"><Select name="role"><option value="MANAGER">事業部責任者</option><option value="ACCOUNTING">経理</option><option value="OWNER">経営者・会社管理者</option></Select></Field>
                <Field label="初期パスワード（10文字以上）" required><Input type="password" name="password" minLength={10} required autoComplete="new-password" /></Field>
              </div>
              <div className="flex flex-wrap gap-3 text-sm"><span className="text-xs font-bold">担当事業部（責任者のみ）:</span>{divisions.map((d) => <label key={d.id} className="inline-flex items-center gap-1"><input type="checkbox" name="divisionIds" value={d.id} />{d.name}</label>)}</div>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">ドライバーは「ドライバー」画面から招待します（LINEでログイン）。</p>
          </div>
        </Card>

        <Card title="外部接続" className="mt-4">
          <ul className="space-y-2 text-sm">{conns.map((c) => <li key={c.key} className="flex items-start gap-2"><ConnBadge state={c.state} /><span><b>{c.label}</b>：{c.detail}</span></li>)}</ul>
          <p className="mt-2 text-xs text-muted">接続情報（APIキーなど）は画面からは登録せず、サーバーの環境変数に設定します。手順は docs/OPERATIONS.md を参照してください。</p>
        </Card>
      </>
    );
  });
}
