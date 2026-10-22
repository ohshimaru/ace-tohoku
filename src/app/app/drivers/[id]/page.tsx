import { ActionForm } from "@/components/action-form";
import { Badge, Card, DefList, Field, Grid, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { getDriver } from "@/server/drivers";
import { partnerOptions, projectOptions } from "@/server/partners";
import { driverProfileAction, driverStatusAction, reissueInviteAction } from "../actions";

export const metadata = { title: "ドライバー" };

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaff();
  const { id } = await params;
  return guard(async () => {
    const db = getDb();
    const { u, d, divisionName } = await getDriver(db, actor, id);
    const [partners, projects] = await Promise.all([partnerOptions(db, actor, "contractor"), projectOptions(db, actor, d.divisionId)]);
    const manage = can.manageDrivers(actor);
    return (
      <>
        <PageHeader title={u.name} back={{ href: "/app/drivers", label: "ドライバー一覧" }} description={divisionName} actions={<Badge tone={L.userStatus[u.status][1]}>{L.userStatus[u.status][0]}</Badge>} />
        <Grid>
          <Card title="アカウント">
            <DefList items={[
              ["LINE", u.lineUserId ? `連携済み${u.lineDisplayName ? `（${u.lineDisplayName}）` : ""}` : "未連携（招待リンクからのログイン待ち）"],
              ["メール", u.email ? `${u.email}（${u.emailVerifiedAt ? "確認済み" : "未確認"}）` : "未登録"],
              ["承認日", formatDateTime(u.approvedAt)],
              ["最終ログイン", formatDateTime(u.lastLoginAt)],
            ]} />
            {manage && (
              <div className="mt-4 flex flex-wrap gap-2">
                {u.status === "PENDING" && <ActionForm action={driverStatusAction} submitLabel="承認して利用開始" inline><input type="hidden" name="id" value={u.id} /><input type="hidden" name="status" value="ACTIVE" /></ActionForm>}
                {u.status === "SUSPENDED" && u.lineUserId && <ActionForm action={driverStatusAction} submitLabel="利用を再開" submitVariant="secondary" inline><input type="hidden" name="id" value={u.id} /><input type="hidden" name="status" value="ACTIVE" /></ActionForm>}
                {u.status !== "SUSPENDED" && <ActionForm action={driverStatusAction} submitLabel="利用停止" submitVariant="danger" inline confirm="停止すると、このドライバーはすぐにログインできなくなります。よろしいですか？"><input type="hidden" name="id" value={u.id} /><input type="hidden" name="status" value="SUSPENDED" /></ActionForm>}
                {!u.lineUserId && u.status !== "SUSPENDED" && <ActionForm action={reissueInviteAction} submitLabel="招待リンクを再発行" submitVariant="secondary"><input type="hidden" name="id" value={u.id} /></ActionForm>}
              </div>
            )}
          </Card>
          <Card title="割当の条件・税の設定">
            {manage ? (
              <ActionForm action={driverProfileAction}>
                <input type="hidden" name="id" value={u.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="資格（読点区切り）" hint="例: 冷凍、危険物"><Input name="qualifications" defaultValue={d.qualifications.join("、")} /></Field>
                  <Field label="車両（読点区切り）" hint="例: 軽バン、2t"><Input name="vehicles" defaultValue={d.vehicles.join("、")} /></Field>
                  <Field label="対応エリア（空欄=制限なし）"><Input name="areas" defaultValue={d.areas.join("、")} /></Field>
                  <Field label="月の稼働日数の上限"><Input name="maxDaysPerMonth" inputMode="numeric" defaultValue={d.maxDaysPerMonth ?? ""} /></Field>
                  <Field label="1日の稼働時間の上限（時間）"><Input name="maxHoursPerDay" inputMode="decimal" defaultValue={d.maxMinutesPerDay ? d.maxMinutesPerDay / 60 : ""} /></Field>
                  <Field label="委託先の取引先"><Select name="partnerId" defaultValue={d.partnerId ?? ""}><option value="">（なし）</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                  <Field label="消費税の扱い" required hint="明細の単価に対する扱い（要確認: インボイス登録の有無など）"><Select name="taxMode" defaultValue={d.taxMode}><option value="EXCLUSIVE">外税（単価は税抜）</option><option value="INCLUSIVE">内税（単価は税込）</option><option value="EXEMPT">消費税なし</option></Select></Field>
                  <Field label="源泉徴収" hint="対象かどうかは税理士等に確認してください（要確認）"><Select name="withholdingEnabled" defaultValue={d.withholdingEnabled ? "1" : "0"}><option value="0">適用しない</option><option value="1">適用する（確認済み）</option></Select></Field>
                  <Field label="源泉徴収の確認記録" className="sm:col-span-2" hint="適用する場合は必須（確認日・確認先・根拠）"><Input name="withholdingConfirmedNote" defaultValue={d.withholdingConfirmedNote ?? ""} maxLength={500} /></Field>
                  <Field label="希望案件（優先条件）" className="sm:col-span-2"><Select name="preferredProjectIds" multiple defaultValue={d.preferredProjectIds} className="h-28">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
                  <Field label="メモ" className="sm:col-span-2"><Textarea name="note" defaultValue={d.note ?? ""} rows={2} /></Field>
                </div>
              </ActionForm>
            ) : (
              <DefList items={[["資格", d.qualifications.join("、") || "—"], ["車両", d.vehicles.join("、") || "—"], ["エリア", d.areas.join("、") || "—"], ["消費税", d.taxMode], ["源泉徴収", d.withholdingEnabled ? "適用" : "なし"]]} />
            )}
          </Card>
        </Grid>
      </>
    );
  });
}
