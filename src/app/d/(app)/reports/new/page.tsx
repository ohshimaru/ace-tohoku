import { DualActionForm } from "@/components/action-form";
import { ReportFields } from "@/components/report-fields";
import { Card, Notice } from "@/components/ui";
import { getDb } from "@/db";
import { DATE_RE, todayJst } from "@/lib/dates";
import { requireDriver } from "@/lib/session";
import { myDriverContext } from "@/server/drivers";
import { myUpcoming } from "@/server/shifts";
import { saveReportAction } from "../../../actions";

export const metadata = { title: "日報を書く" };

export default async function NewReport({ searchParams }: { searchParams: Promise<{ date?: string; project?: string }> }) {
  const actor = await requireDriver();
  const sp = await searchParams;
  const db = getDb();
  const ctx = await myDriverContext(db, actor);
  const today = todayJst();
  const date = sp.date && DATE_RE.test(sp.date) && sp.date <= today ? sp.date : today;
  // 確定スケジュールから初期値（同じ日・案件の確定割当）
  const plan = (await myUpcoming(db, actor, date, date)).find((p) => !sp.project || p.projectId === sp.project);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">日報を書く</h1>
      {ctx.projects.length === 0 ? <Notice tone="warn">入力できる案件がありません。会社の担当者にお問い合わせください。</Notice> : (
        <Card>
          <DualActionForm action={saveReportAction} confirmSubmit="提出しますか？提出後は会社側の承認または差戻しまで編集できません。">
            <ReportFields projects={ctx.projects} maxDate={today} v={{ workDate: date, projectId: plan?.projectId ?? sp.project, startTime: plan?.start, endTime: plan?.end }} schedule={plan ? `${plan.projectName} ${plan.start.slice(0, 5)}〜${plan.end.slice(0, 5)}` : undefined} />
          </DualActionForm>
        </Card>
      )}
    </div>
  );
}
