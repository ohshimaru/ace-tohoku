import { ActionForm } from "@/components/action-form";
import { Badge, Card, DefList, Field, Grid, Input, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { getContract } from "@/server/contracts";
import { contractStatusAction, signedFileAction, updateContractAction } from "../actions";
import { ContractFields } from "../contract-fields";
import { contractOptions } from "../options";

export const metadata = { title: "契約書" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getContract(db, actor, id);
    const c = x.c;
    const manage = can.manageContracts(actor);
    const o = manage && c.status !== "ENDED" ? await contractOptions(db, actor) : null;
    const op = (to: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary", confirm?: string) => (
      <ActionForm action={contractStatusAction} inline submitLabel={label} submitVariant={variant} confirm={confirm}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value={to} /></ActionForm>
    );
    return (
      <>
        <PageHeader title={c.title} back={{ href: "/app/contracts", label: "契約書一覧" }} description={`${x.partnerName}／${x.divisionName}／第${c.revision}版`} actions={<Badge tone={L.contract[c.status][1]}>{L.contract[c.status][0]}</Badge>} />
        {x.template.status !== "APPROVED" && c.status === "DRAFT" && <Notice tone="warn">使用中のテンプレート（第{x.template.version}版）は現在承認済みではありません。承認済みの版を選び直してください。</Notice>}
        {x.missing.length > 0 && <Notice tone="warn" title="未入力の項目">{x.missing.join("、")}</Notice>}
        {manage && (
          <div className="my-4 flex flex-wrap gap-2">
            {c.status === "DRAFT" && op("REVIEWED", "社内確認済みにする")}
            {c.status === "REVIEWED" && op("DRAFT", "下書きに戻す")}
            {c.status === "REVIEWED" && op("SENT", "送付済みにする", "primary", "相手方に送付したことを記録します（このシステムからは送信しません）。よろしいですか？")}
            {c.status === "SENT" && op("SIGNED", "締結済みにする", "primary", "締結済みの契約書ファイルを確認しましたか？")}
            {c.status === "SIGNED" && op("ENDED", "終了にする", "danger", "契約を終了にします。よろしいですか？")}
            <a className="inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm" href={`/api/export/contract?id=${c.id}`}>PDF</a>
          </div>
        )}
        <Grid>
          <Card title="プレビュー">
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-canvas p-4 font-sans text-sm leading-7">{c.renderedBody}</pre>
          </Card>
          <div className="space-y-4">
            <Card title="記録">
              <DefList items={[
                ["テンプレート", `${x.template.name}（第${x.template.version}版）`],
                ["契約期間", `${formatDate(c.terms.periodStart)}〜${formatDate(c.terms.periodEnd)}`],
                ["更新の通知", `${c.renewalNoticeDays}日前`],
                ["社内確認", formatDateTime(c.reviewedAt)],
                ["送付", formatDateTime(c.sentAt)],
                ["締結", formatDateTime(c.signedAt)],
                ["終了", formatDateTime(c.endedAt)],
              ]} />
            </Card>
            <Card title="締結済みの契約書ファイル">
              {x.files.length === 0 ? <p className="text-sm text-muted">まだ保存されていません。</p> : <ul className="text-sm">{x.files.map((f) => <li key={f.id}><a className="text-navy-700 underline" href={`/api/files/${f.id}`}>{f.name}</a> <span className="text-xs text-muted">{formatDateTime(f.createdAt)}</span>{f.id === c.signedFileId && <Badge tone="ok">最新</Badge>}</li>)}</ul>}
              {manage && (c.status === "SENT" || c.status === "SIGNED") && (
                <ActionForm action={signedFileAction} submitLabel="保存" submitVariant="secondary" className="mt-3 space-y-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required />
                </ActionForm>
              )}
              <p className="mt-2 text-xs text-muted">電子署名サービスとの連携は未接続です。署名済みのPDFなどを保存してください。</p>
            </Card>
          </div>
        </Grid>
        {o && (
          <Card title={c.status === "SENT" || c.status === "SIGNED" ? "改訂する（新しい版を下書きで作成）" : "編集"} className="mt-6">
            <ActionForm action={updateContractAction} submitLabel={c.status === "SENT" || c.status === "SIGNED" ? "改訂版を作成" : "保存"} confirm={c.status === "SIGNED" ? "締結済みの契約を改訂すると、新しい版は下書きになり、締結し直しが必要です。よろしいですか？" : undefined}>
              <input type="hidden" name="id" value={c.id} />
              <ContractFields c={c} {...o} />
              <Field label={c.status === "SENT" || c.status === "SIGNED" ? "改訂の理由（必須）" : "変更メモ（任意）"} required={c.status === "SENT" || c.status === "SIGNED"}><Input name="reason" maxLength={500} /></Field>
            </ActionForm>
          </Card>
        )}
        {x.revisions.length > 0 && (
          <Card title="改訂履歴" className="mt-6">
            <Table>
              <thead><tr><Th>版</Th><Th>理由</Th><Th>報酬</Th><Th>期間</Th><Th>日時</Th></tr></thead>
              <tbody>{x.revisions.map((r) => <tr key={r.id}><Td>第{r.revision}版</Td><Td>{r.reason}</Td><Td>{r.terms.fee}</Td><Td>{r.terms.periodStart}〜{r.terms.periodEnd}</Td><Td>{formatDateTime(r.createdAt)}</Td></tr>)}</tbody>
            </Table>
          </Card>
        )}
      </>
    );
  });
}
