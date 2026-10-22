import { DualActionForm } from "@/components/action-form";
import { ReportFields } from "@/components/report-fields";
import { Badge, Card, DefList, Notice } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime, formatMinutes, todayJst, weekdayJa } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireDriver } from "@/lib/session";
import { myDriverContext } from "@/server/drivers";
import { getReport } from "@/server/reports";
import { saveReportAction } from "../../../actions";

export const metadata = { title: "日報" };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDriver();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await getReport(db, actor, id);
    const r = x.r;
    const editable = r.status === "DRAFT" || r.status === "RETURNED";
    const ctx = editable ? await myDriverContext(db, actor) : null;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-navy-900">{formatDate(r.workDate)}（{weekdayJa(r.workDate)}）の日報</h1>
          <Badge tone={L.report[r.status][1]}>{L.report[r.status][0]}</Badge>
        </div>
        {r.status === "RETURNED" && <Notice tone="warn" title="差戻されました">{r.returnReason}</Notice>}
        {r.status === "SUBMITTED" && <Notice tone="info">提出済みです。会社側の確認をお待ちください。</Notice>}
        {editable && ctx ? (
          <Card>
            <DualActionForm action={saveReportAction} submitLabel={r.status === "RETURNED" ? "修正して再提出" : "提出する"}>
              <input type="hidden" name="id" value={r.id} />
              <ReportFields projects={ctx.projects} maxDate={todayJst()} v={{ ...r }} />
            </DualActionForm>
          </Card>
        ) : (
          <Card>
            <DefList items={[
              ["案件", x.projectName],
              ["時間", `${r.startTime.slice(0, 5)}〜${r.endTime.slice(0, 5)}（休憩 ${r.breakMinutes}分・実働 ${formatMinutes(toMin(r.endTime) - toMin(r.startTime) - r.breakMinutes)}）`],
              ...(r.quantity ? [["実績数量", `${Number(r.quantity)} ${x.reportFields.quantityUnit}`] as [string, string]] : []),
              ...(r.distanceKm ? [["走行距離", `${Number(r.distanceKm)} km`] as [string, string]] : []),
              ["内容", r.notes || "—"],
              ["提出", formatDateTime(r.submittedAt)],
              ...(r.version > 1 ? [["訂正", `会社側で訂正されています（第${r.version}版）`] as [string, string]] : []),
            ]} />
          </Card>
        )}
        {x.files.length > 0 && (
          <Card title="添付">
            <ul className="space-y-1 text-sm">{x.files.map((f) => <li key={f.id}><a className="text-navy-700 underline" href={`/api/files/${f.id}`}>{f.name}</a></li>)}</ul>
          </Card>
        )}
      </div>
    );
  });
}
