import { ActionForm } from "@/components/action-form";
import { ReportDecision } from "@/components/report-decision";
import { Badge, Card, DefList, Field, Grid, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime, formatMinutes, weekdayJa } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { projectOptions } from "@/server/partners";
import { getReport } from "@/server/reports";
import { correctReportAction } from "../actions";

export const metadata = { title: "日報" };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export default async function StaffReport({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getReport(db, actor, id);
    const r = x.r;
    const projects = r.status === "APPROVED" ? await projectOptions(db, actor, x.divisionId) : [];
    const rf = x.reportFields;
    return (
      <>
        <PageHeader title={`${x.driverName}　${formatDate(r.workDate)}（${weekdayJa(r.workDate)}）`} back={{ href: "/app/reports", label: "日報一覧" }} actions={<Badge tone={L.report[r.status][1]}>{L.report[r.status][0]}</Badge>} />
        <Grid>
          <Card title="内容">
            <DefList items={[
              ["案件", `${x.projectCode} ${x.projectName}`],
              ["時間", `${r.startTime.slice(0, 5)}〜${r.endTime.slice(0, 5)}（休憩 ${r.breakMinutes}分・実働 ${formatMinutes(toMin(r.endTime) - toMin(r.startTime) - r.breakMinutes)}）`],
              ["実績数量", r.quantity ? `${Number(r.quantity)} ${rf.quantityUnit}` : "—"],
              ["走行距離", r.distanceKm ? `${Number(r.distanceKm)} km` : "—"],
              ["内容", r.notes || "—"],
              ["確定スケジュール", r.assignmentId ? "あり（紐付け済み）" : "なし"],
              ["提出", formatDateTime(r.submittedAt)],
              ["稼働明細", r.statementId ? "明細に含まれています" : "未反映"],
            ]} />
            {x.files.length > 0 && <ul className="mt-3 text-sm">{x.files.map((f) => <li key={f.id}><a className="text-navy-700 underline" href={`/api/files/${f.id}`}>{f.name}</a></li>)}</ul>}
            {r.status === "SUBMITTED" && <div className="mt-4"><ReportDecision id={r.id} returnTo={`/app/reports/${r.id}`} /></div>}
            {r.returnReason && <p className="mt-3 text-sm text-warn">差戻し理由: {r.returnReason}</p>}
          </Card>
          {r.status === "APPROVED" && (
            <Card title="承認後の訂正">
              <p className="mb-3 text-xs text-muted">訂正前の内容は履歴に残ります。確定済みの稼働明細に含まれる日報は、明細の訂正版を作ってから訂正してください。</p>
              <ActionForm action={correctReportAction} submitLabel="訂正する" submitVariant="secondary">
                <input type="hidden" name="id" value={r.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="稼働日"><Input type="date" name="workDate" defaultValue={r.workDate} required /></Field>
                  <Field label="案件"><Select name="projectId" defaultValue={r.projectId}>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
                  <Field label="開始"><Input type="time" name="startTime" defaultValue={r.startTime.slice(0, 5)} required /></Field>
                  <Field label="終了"><Input type="time" name="endTime" defaultValue={r.endTime.slice(0, 5)} required /></Field>
                  <Field label="休憩（分）"><Input name="breakMinutes" defaultValue={r.breakMinutes} /></Field>
                  {rf.quantity && <Field label={`数量（${rf.quantityUnit}）`}><Input name="quantity" defaultValue={r.quantity ?? ""} /></Field>}
                  {rf.distance && <Field label="距離（km）"><Input name="distanceKm" defaultValue={r.distanceKm ?? ""} /></Field>}
                  <Field label="内容" className="col-span-2"><Textarea name="notes" defaultValue={r.notes} rows={2} /></Field>
                  <Field label="訂正理由" required className="col-span-2"><Input name="reason" required maxLength={500} /></Field>
                </div>
              </ActionForm>
            </Card>
          )}
        </Grid>
        {x.revisions.length > 0 && (
          <Card title="訂正履歴" className="mt-6">
            <Table>
              <thead><tr><Th>版</Th><Th>訂正前の時間</Th><Th>訂正前の数量</Th><Th>理由</Th><Th>日時</Th></tr></thead>
              <tbody>{x.revisions.map((v) => {
                const s = v.snapshot as { startTime: string; endTime: string; breakMinutes: number; quantity: string | null };
                return <tr key={v.id}><Td>第{v.version}版</Td><Td className="tabular">{s.startTime?.slice(0, 5)}〜{s.endTime?.slice(0, 5)}（休{s.breakMinutes}分）</Td><Td>{s.quantity ?? "—"}</Td><Td>{v.reason}</Td><Td>{formatDateTime(v.createdAt)}</Td></tr>;
              })}</tbody>
            </Table>
          </Card>
        )}
      </>
    );
  });
}
