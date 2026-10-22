import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, Grid, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { getPartner } from "@/server/partners";
import { addNoteAction, archivePartnerAction, savePartnerAction } from "../actions";
import { PartnerFields } from "../partner-fields";

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const [x, divisions] = await Promise.all([getPartner(db, actor, id), listDivisions(db, actor)]);
    const p = x.partner;
    return (
      <>
        <PageHeader
          title={p.name}
          back={{ href: "/app/partners", label: "取引先一覧" }}
          description={<span className="flex gap-1">{p.isCustomer && <Badge tone="info">顧客</Badge>}{p.isContractor && <Badge tone="navy">業務委託先</Badge>}{p.archivedAt && <Badge tone="warn">アーカイブ済み</Badge>}</span>}
          actions={<>{p.isCustomer && <LinkButton href={`/app/projects?customer=${p.id}#new`}>案件を登録</LinkButton>}<LinkButton href={`/app/contracts/new?partner=${p.id}`}>契約書を作成</LinkButton></>}
        />
        <Grid>
          <Card title="案件">
            {x.projects.length === 0 ? <EmptyState title="案件はありません" /> : (
              <ul className="divide-y divide-line text-sm">{x.projects.map((pj) => (
                <li key={pj.id} className="flex flex-wrap justify-between gap-2 py-2"><Link className="text-navy-700 hover:underline" href={`/app/projects/${pj.id}`}>{pj.code} {pj.name}</Link><span className="flex gap-1"><Badge>{pj.divisionName}</Badge><Badge>{L.contractType[pj.contractType]}</Badge><Badge tone={L.projectStatus[pj.status][1]}>{L.projectStatus[pj.status][0]}</Badge></span></li>
              ))}</ul>
            )}
          </Card>
          <Card title="契約">
            {x.contracts.length === 0 ? <EmptyState title="契約はありません" /> : (
              <ul className="divide-y divide-line text-sm">{x.contracts.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2"><Link className="text-navy-700 hover:underline" href={`/app/contracts/${c.id}`}>{c.title}</Link><span className="flex gap-1">{c.periodEnd && <Badge>〜{formatDate(c.periodEnd)}</Badge>}<Badge tone={L.contract[c.status][1]}>{L.contract[c.status][0]}</Badge></span></li>
              ))}</ul>
            )}
          </Card>
        </Grid>
        <Card title="対応メモ" className="mt-4">
          {x.notes.length === 0 ? <p className="text-sm text-muted">メモはありません。</p> : (
            <ul className="space-y-2 text-sm">{x.notes.map((n) => <li key={n.id} className="rounded bg-navy-50 p-2"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-xs text-muted">{formatDateTime(n.createdAt)}{n.divisionId ? `・${divisions.find((d) => d.id === n.divisionId)?.name ?? ""}` : ""}</p></li>)}</ul>
          )}
          <div className="mt-3"><ActionForm action={addNoteAction} submitLabel="メモを追加" submitVariant="secondary" resetOnSuccess>
            <input type="hidden" name="id" value={p.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="事業部"><Select name="divisionId">{actor.role !== "MANAGER" && <option value="">全社</option>}{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
              <Field label="内容" className="sm:col-span-3"><Textarea name="body" rows={2} required /></Field>
            </div>
          </ActionForm></div>
        </Card>
        <Card title="基本情報の編集" className="mt-4">
          <ActionForm action={savePartnerAction} submitLabel="保存する">
            <input type="hidden" name="id" value={p.id} />
            <PartnerFields p={p} divisions={divisions} divisionIds={x.divisionIds} />
          </ActionForm>
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={archivePartnerAction} inline submitLabel={p.archivedAt ? "アーカイブから戻す" : "アーカイブする"} submitVariant={p.archivedAt ? "secondary" : "danger"}>
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="archived" value={p.archivedAt ? "0" : "1"} />
              <Input type="hidden" name="_" />
            </ActionForm>
          </div>
        </Card>
      </>
    );
  });
}
