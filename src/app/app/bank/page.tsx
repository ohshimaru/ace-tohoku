import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { BANK_CSV_HEADER, listBankAccounts, listSyncRuns, listTransactions } from "@/server/bank";
import { archiveAccountAction, createAccountAction, importCsvAction, syncAction } from "./actions";

export const metadata = { title: "銀行口座" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ account?: string; view?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const [accounts, txns, runs] = await Promise.all([listBankAccounts(db, actor), listTransactions(db, actor, { accountId: sp.account, view: sp.view }), listSyncRuns(db, actor)]);
    const total = accounts.reduce((t, a) => t + (a.a.balance ?? 0), 0);
    return (
      <>
        <PageHeader title="銀行口座" description="残高と入出金を確認し、入金・支払予定と照合します。このシステムは送金・振込を行いません。口座番号は下4桁だけを保存し、銀行のログイン情報は保存しません。銀行残高は予算の使用可能額とは別のものです。" />
        <Notice tone="info" title="銀行との接続">実際の銀行API・口座情報サービスとの自動連携は未接続です。銀行サイトから取得した明細をCSVで取り込むか、デモ口座（架空データ）で動作を確認できます。</Notice>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.length === 0 && <EmptyState title="口座が登録されていません">下の「口座を登録」から追加してください。</EmptyState>}
          {accounts.map(({ a, unmatched }) => (
            <Card key={a.id} title={<span>{a.bankName} {a.branchName}</span>} actions={a.isDemo ? <Badge tone="warn">デモ</Badge> : <Badge>{a.provider === "CSV" ? "CSV取込" : a.provider}</Badge>}>
              <p className="text-sm text-muted">{a.accountType} ****{a.accountNumberLast4} {a.holderName}</p>
              <p className="tabular mt-1 text-2xl font-bold text-navy-900">{a.balance == null ? "残高未取得" : formatYen(a.balance)}</p>
              <p className="text-xs text-muted">残高時点: {formatDateTime(a.balanceAsOf)}／最終取込: {formatDateTime(a.lastSyncedAt)}</p>
              {a.syncStatus === "FAILED" && <Notice tone="bad" title="同期に失敗">{a.lastError}</Notice>}
              <p className="mt-2 text-sm"><Link className="text-navy-700 underline" href={`/app/bank?account=${a.id}&view=unmatched`}>未照合 {unmatched}件</Link>　<Link className="text-navy-700 underline" href={`/app/bank?account=${a.id}`}>取引一覧</Link></p>
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                {a.provider !== "CSV" && <ActionForm action={syncAction} submitLabel="同期（再試行）" submitVariant="secondary"><input type="hidden" name="id" value={a.id} /></ActionForm>}
                <ActionForm action={importCsvAction} submitLabel="明細CSVを取込" submitVariant="secondary">
                  <input type="hidden" name="id" value={a.id} />
                  <Input type="file" name="file" accept=".csv,text/csv" required />
                </ActionForm>
                <ActionForm action={archiveAccountAction} submitLabel="この口座を非表示" submitVariant="ghost" confirm="口座を非表示にします（取引の記録は残ります）。よろしいですか？"><input type="hidden" name="id" value={a.id} /></ActionForm>
              </div>
            </Card>
          ))}
        </div>
        {accounts.length > 0 && <p className="mt-2 text-sm">口座残高の合計: <strong className="tabular">{formatYen(total)}</strong>{accounts.some((a) => a.a.isDemo) && "（デモ口座を含む）"}</p>}
        <Card title="取引" className="mt-6">
          <FilterBar>
            <Field label="口座"><Select name="account" defaultValue={sp.account ?? ""}><option value="">すべて</option>{accounts.map(({ a }) => <option key={a.id} value={a.id}>{a.bankName} ****{a.accountNumberLast4}</option>)}</Select></Field>
            <Field label="表示"><Select name="view" defaultValue={sp.view ?? ""}><option value="">すべて</option><option value="unmatched">未照合のみ</option></Select></Field>
          </FilterBar>
          {txns.length === 0 ? <EmptyState title="取引はありません" /> : (
            <Table>
              <thead><tr><Th>日付</Th><Th>口座</Th><Th>内容</Th><Th className="text-right">入金</Th><Th className="text-right">出金</Th><Th className="text-right">残高</Th><Th>区分</Th><Th>照合</Th></tr></thead>
              <tbody>{txns.map(({ t, bankName, isDemo, matched }) => {
                const full = matched >= Math.abs(t.amount);
                return (
                  <tr key={t.id}>
                    <Td>{formatDate(t.txnDate)}</Td>
                    <Td className="text-xs">{bankName}{isDemo && <Badge tone="warn">デモ</Badge>}</Td>
                    <Td><Link className="text-navy-700 underline" href={`/app/bank/${t.id}`}>{t.description}</Link></Td>
                    <Td className="tabular text-right text-ok">{t.amount > 0 ? formatYen(t.amount) : ""}</Td>
                    <Td className="tabular text-right">{t.amount < 0 ? formatYen(-t.amount) : ""}</Td>
                    <Td className="tabular text-right">{t.balanceAfter == null ? "" : formatYen(t.balanceAfter)}</Td>
                    <Td className="text-xs">{L.bankClass[t.classification]}</Td>
                    <Td>{full ? <Badge tone="ok">照合済み</Badge> : matched > 0 ? <Badge tone="warn">一部照合</Badge> : ["TRANSFER", "LOAN", "TAX", "OTHER"].includes(t.classification) ? <Badge>対象外</Badge> : <Badge tone="bad">未照合</Badge>}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="口座を登録">
            <ActionForm action={createAccountAction} submitLabel="登録" submitVariant="secondary" resetOnSuccess>
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
            <p className="text-sm">見出し行: <code className="rounded bg-navy-50 px-1">{BANK_CSV_HEADER.join(",")}</code>（残高は任意）。日付は 2026-10-01 または 2026/10/01。入金・出金はどちらか一方に金額を入れてください。同じ明細を何度取り込んでも重複しません。</p>
            <ul className="mt-3 divide-y divide-line text-xs">
              {runs.map(({ r, bankName }) => <li key={r.id} className="py-1">{formatDateTime(r.startedAt)} {bankName} {r.kind === "CSV" ? "CSV取込" : "同期"} <Badge tone={r.status === "OK" ? "ok" : r.status === "FAILED" ? "bad" : "info"}>{r.status === "OK" ? "成功" : r.status === "FAILED" ? "失敗" : "実行中"}</Badge> 新規{r.imported}・既存{r.skipped}{r.error && `：${r.error}`}</li>)}
            </ul>
          </Card>
        </div>
      </>
    );
  });
}
