import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, Input, Notice, Select } from "@/components/ui";
import { getDb } from "@/db";
import { formatDateTime, todayJst } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { BANK_CSV_HEADER, listBankAccounts, listSyncRuns } from "@/server/bank";
import { addManualAction, archiveAccountAction, createAccountAction, importCsvAction, syncAction } from "../../actions";

export const metadata = { title: "口座・取込" };

export default async function AccountsPage({ params }: { params: Promise<{ cid: string }> }) {
  const actor = await requireProvider();
  const { cid } = await params;
  return guard(async () => {
    const db = getDb();
    const [accounts, runs] = await Promise.all([listBankAccounts(db, actor, cid), listSyncRuns(db, actor, cid)]);
    const c = <input type="hidden" name="companyId" value={cid} />;
    return (
      <>
        <Notice tone="info" title="銀行との接続">実際の銀行API・口座情報サービスとの自動連携は未接続です（契約と正式な認可方式が必要）。銀行サイトから取得した明細CSVを取り込むか、デモ口座（架空データ）で確認できます。口座番号は下4桁だけを保存し、銀行のログイン情報は保存しません。送金・振込の機能はありません。</Notice>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.length === 0 && <EmptyState title="口座が登録されていません">下の「口座を登録」から追加してください。</EmptyState>}
          {accounts.map(({ a, unmatched }) => (
            <Card key={a.id} title={<span>{a.bankName} {a.branchName}</span>} actions={a.isDemo ? <Badge tone="warn">デモ</Badge> : <Badge>{a.provider === "CSV" ? "CSV取込" : a.provider}</Badge>}>
              <p className="text-sm text-muted">{a.accountType} ****{a.accountNumberLast4} {a.holderName}</p>
              <p className="tabular mt-1 text-2xl font-bold text-navy-900">{a.balance == null ? "残高未取得" : formatYen(a.balance)}</p>
              <p className="text-xs text-muted">残高時点: {formatDateTime(a.balanceAsOf)}／最終取込: {formatDateTime(a.lastSyncedAt)}</p>
              {a.syncStatus === "FAILED" && <Notice tone="bad" title="同期に失敗">{a.lastError}</Notice>}
              <p className="mt-2 text-sm"><Link className="text-navy-700 underline" href={`/p/${cid}?account=${a.id}`}>この口座の取引</Link>（未照合 {unmatched}件）</p>
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                {a.provider !== "CSV" && <ActionForm action={syncAction} submitLabel="同期（再試行）" submitVariant="secondary">{c}<input type="hidden" name="id" value={a.id} /></ActionForm>}
                <ActionForm action={importCsvAction} submitLabel="明細CSVを取込" submitVariant="secondary">
                  {c}<input type="hidden" name="id" value={a.id} />
                  <Input type="file" name="file" accept=".csv,text/csv" required />
                </ActionForm>
                <ActionForm action={archiveAccountAction} submitLabel="この口座を非表示" submitVariant="ghost" confirm="口座を非表示にします（取引の記録は残ります）。よろしいですか？">{c}<input type="hidden" name="id" value={a.id} /></ActionForm>
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="手動取引を登録">
            {accounts.length === 0 ? <p className="text-sm text-muted">先に口座を登録してください。</p> : (
              <ActionForm action={addManualAction} submitLabel="下書きとして登録" submitVariant="secondary" className="space-y-3">
                {c}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="口座" required className="col-span-2"><Select name="accountId">{accounts.map(({ a }) => <option key={a.id} value={a.id}>{a.bankName} ****{a.accountNumberLast4}</option>)}</Select></Field>
                  <Field label="日付" required><Input type="date" name="txnDate" defaultValue={todayJst()} required /></Field>
                  <Field label="入出金" required><Select name="direction"><option value="in">入金</option><option value="out">出金</option></Select></Field>
                  <Field label="金額（円）" required><Input name="amount" inputMode="numeric" required /></Field>
                  <Field label="内容" required><Input name="description" maxLength={200} required /></Field>
                </div>
                <Field label="登録の理由" required hint="銀行から取得できない取引などに使います。理由は操作履歴に残ります"><Input name="reason" maxLength={300} required /></Field>
              </ActionForm>
            )}
          </Card>
          <Card title="口座を登録">
            <ActionForm action={createAccountAction} submitLabel="登録" submitVariant="secondary" resetOnSuccess>
              {c}
              <div className="grid grid-cols-2 gap-3">
                <Field label="銀行名" required><Input name="bankName" required /></Field>
                <Field label="支店名" required><Input name="branchName" required /></Field>
                <Field label="種別"><Select name="accountType"><option>普通</option><option>当座</option><option>貯蓄</option></Select></Field>
                <Field label="口座番号の下4桁" required hint="全桁は入力しないでください"><Input name="last4" inputMode="numeric" maxLength={4} pattern="\d{4}" required /></Field>
                <Field label="名義（任意）"><Input name="holderName" /></Field>
                <Field label="開始時点の残高（任意）"><Input name="openingBalance" inputMode="numeric" /></Field>
                <Field label="取込方法" className="col-span-2"><Select name="provider"><option value="CSV">明細CSVを取り込む</option><option value="DEMO">デモ（架空データで動作確認）</option></Select></Field>
              </div>
            </ActionForm>
          </Card>
          <Card title="明細CSVの形式と取込履歴">
            <p className="text-sm">見出し行: <code className="rounded bg-navy-50 px-1">{BANK_CSV_HEADER.join(",")}</code>（残高は任意）。日付は 2026-10-01 または 2026/10/01。入金・出金はどちらか一方に金額を入れてください。同じ明細を何度取り込んでも重複しません。取り込んだ取引は下書き（非公開）になります。</p>
            <ul className="mt-3 divide-y divide-line text-xs">
              {runs.map(({ r, bankName }) => <li key={r.id} className="py-1">{formatDateTime(r.startedAt)} {bankName} {r.kind === "CSV" ? "CSV取込" : "同期"} <Badge tone={r.status === "OK" ? "ok" : r.status === "FAILED" ? "bad" : "info"}>{r.status === "OK" ? "成功" : r.status === "FAILED" ? "失敗" : "実行中"}</Badge> 新規{r.imported}・既存{r.skipped}{r.error && `：${r.error}`}</li>)}
            </ul>
          </Card>
        </div>
      </>
    );
  });
}
