import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Textarea } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { formatDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/session";
import { listTemplates, TERM_LABELS } from "@/server/contracts";
import { approveTemplateAction, createTemplateAction, retireTemplateAction } from "../actions";

export const metadata = { title: "契約テンプレート" };
const ST: Record<string, [string, "warn" | "ok" | "neutral"]> = { UNREVIEWED: ["未確認", "warn"], APPROVED: ["承認済み", "ok"], RETIRED: ["廃止", "neutral"] };

export default async function TemplatesPage() {
  const actor = await requireStaff();
  const rows = await listTemplates(getDb());
  return (
    <>
      <PageHeader title="契約テンプレート" back={{ href: "/app/contracts", label: "契約書" }} description="テンプレートは版で管理します。経営者が内容を確認して承認した版だけが契約書の作成に使えます。承認すると、同じ種類の以前の版は廃止になります（作成済みの契約書はそのまま）。" />
      <Notice tone="warn" title="法的な確認について">初期のテンプレートはひな形（未確認）です。実際に使う前に、内容を弁護士・社労士などの専門家に確認してください。</Notice>
      <div className="mt-4 space-y-4">
        {rows.length === 0 && <EmptyState title="テンプレートがありません" />}
        {rows.map((t) => (
          <Card key={t.id} title={<span>{t.name}　第{t.version}版 <span className="text-xs font-normal text-muted">({t.key})</span></span>} actions={<Badge tone={ST[t.status][1]}>{ST[t.status][0]}</Badge>}>
            <details>
              <summary className="cursor-pointer text-sm text-navy-700">本文を表示</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-canvas p-3 font-sans text-sm">{t.body}</pre>
            </details>
            {t.note && <p className="mt-2 text-xs text-muted">確認記録: {t.note}（{formatDateTime(t.approvedAt)}）</p>}
            {can.approveTemplates(actor) && t.status === "UNREVIEWED" && (
              <ActionForm action={approveTemplateAction} inline submitLabel="承認" submitVariant="primary">
                <input type="hidden" name="id" value={t.id} />
                <Input name="note" placeholder="確認内容（例: 2026-10-20 ○○弁護士確認）" required className="w-80" />
              </ActionForm>
            )}
            {can.approveTemplates(actor) && t.status === "APPROVED" && <ActionForm action={retireTemplateAction} inline submitLabel="廃止" submitVariant="ghost"><input type="hidden" name="id" value={t.id} /></ActionForm>}
          </Card>
        ))}
      </div>
      {can.manageContracts(actor) && (
        <Card title="新しい版を作成" className="mt-6">
          <ActionForm action={createTemplateAction} submitLabel="作成（未確認）" submitVariant="secondary">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="種類キー" required hint="同じキーで作ると次の版になります（例: outsourcing）"><Input name="key" required pattern="[a-z0-9-]{2,40}" /></Field>
              <Field label="テンプレート名" required><Input name="name" required /></Field>
              <Field label="本文" required className="sm:col-span-2" hint={<>差し込み: {"{{title}}"} {"{{today}}"} {Object.entries(TERM_LABELS).map(([k, v]) => `{{${k}}}=${v}`).join("　")}</>}><Textarea name="body" rows={14} required /></Field>
              <Field label="メモ" className="sm:col-span-2"><Input name="note" /></Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
