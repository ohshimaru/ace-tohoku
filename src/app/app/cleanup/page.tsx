import { desc, inArray } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { ConnBadge } from "@/components/conn-badge";
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { importRun } from "@/db/schema";
import { formatDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/session";
import { CLEANUP_INVOICE_HEADER } from "@/server/cleanup";
import { connectionStatus } from "@/server/integrations";
import { getSettings, listDivisions } from "@/server/masters";
import { importCleanupAction } from "./actions";

export const metadata = { title: "Clean Up連携" };

export default async function CleanupPage() {
  const actor = await requireStaff();
  const db = getDb();
  const [s, divisions, conns, runs] = await Promise.all([getSettings(db), listDivisions(db, actor), connectionStatus(db), db.select().from(importRun).where(inArray(importRun.source, ["CLEANUP_INVOICES"])).orderBy(desc(importRun.startedAt)).limit(20)]);
  const cln = divisions.filter((d) => d.kind === "CLEANING");
  const conn = conns.find((c) => c.key === "cleanup");
  return (
    <>
      <PageHeader title="Clean Up連携（清掃事業部）" description="清掃事業部の現場・請求は既存の Clean Up で管理します。このシステムでは Clean Up を作り直さず、請求書CSVを取り込んで売上として集計します。Clean Up のデータは読み取るだけで、変更しません。" actions={conn && <span className="flex items-center gap-2 text-sm">状態: <ConnBadge state={conn.state} /></span>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Clean Up を開く">
          {s.cleanupUrl ? (
            <a href={s.cleanupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-md bg-navy-700 px-4 text-sm font-bold text-white">Clean Up 管理画面を開く ↗</a>
          ) : <Notice tone="warn">Clean Up のURLが未設定です。設定 → 会社情報 で登録してください（経営者）。</Notice>}
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
            <li>Clean Up には外部システム向けのAPIがないため、自動連携は行いません（CSV取込で連携）。</li>
            <li>Clean Up の管理画面（請求書一覧）から請求書のCSVを出力し、右の取込に使ってください。</li>
            <li>品目別（明細行）のCSVではなく、通常の請求書一覧のCSVを使います。</li>
            <li>Clean Up の粗利は合算しません。売上は Clean Up の請求、外注費・経費はこのシステムの経費として集計します。</li>
          </ul>
        </Card>
        <Card title="請求書CSVの取込">
          {cln.length === 0 ? <EmptyState title="清掃（Clean Up連携）の事業部がありません">設定 → 事業部 で種類「清掃（Clean Up連携）」の事業部を作成してください。</EmptyState> : (
            <ActionForm action={importCleanupAction} submitLabel="取り込む">
              <Field label="事業部" required><Select name="divisionId" defaultValue={cln[0].id}>{cln.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
              <Field label="Clean Up の請求書CSV" required><Input type="file" name="file" accept=".csv,text/csv" required /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="createCustomers" value="1" className="h-4 w-4" /> 未登録の取引先を顧客として登録する（外すと顧客なしで登録）</label>
            </ActionForm>
          )}
          <div className="mt-4 text-xs text-muted">
            <p>必要な列: {CLEANUP_INVOICE_HEADER.join(",")}</p>
            <p className="mt-1">請求書番号で重複を防ぎます（同じCSVを何度取り込んでも重複しません）。金額・日付が変わった請求書は更新し、状態が void（無効）の請求書は取り込まず、取込済みなら取消します。計上月は「期間終了」の月です。月次締め済みの月は変更しません。入金は銀行照合または手動で登録してください。</p>
          </div>
        </Card>
      </div>
      <Card title="外注費（Clean Up の支払明細）について" className="mt-6">
        <p className="text-sm">Clean Up の外注スタッフへの支払明細は自動では取り込みません。清掃事業部の経費（費目: 外注費）として登録し、二重計上を防ぐため用途欄に Clean Up の支払明細番号（PAY-…）を記入してください。</p>
      </Card>
      <Card title="取込履歴" className="mt-6">
        {runs.length === 0 ? <EmptyState title="取込履歴はありません" /> : (
          <Table>
            <thead><tr><Th>日時</Th><Th>ファイル</Th><Th>結果</Th><Th>新規</Th><Th>更新</Th><Th>変更なし</Th><Th>エラー</Th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}><Td>{formatDateTime(r.startedAt)}</Td><Td className="text-xs">{r.fileName}</Td><Td><Badge tone={r.status === "OK" ? "ok" : "bad"}>{r.status === "OK" ? "成功" : "失敗"}</Badge></Td><Td>{r.created}</Td><Td>{r.updated}</Td><Td>{r.skipped}</Td><Td className="text-xs">{r.errors.slice(0, 3).join(" / ")}</Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
