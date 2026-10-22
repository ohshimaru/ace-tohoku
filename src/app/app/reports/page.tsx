import Link from "next/link";
import { ReportDecision } from "@/components/report-decision";
import { Badge, Card, EmptyState, Field, FilterBar, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { currentMonthJst, formatDate, MONTH_RE, weekdayJa } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";
import { listReports, missingReports } from "@/server/reports";

export const metadata = { title: "日報" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string; status?: string; division?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonthJst();
    const [rows, missing, divisions] = await Promise.all([listReports(db, actor, { month, status: sp.status, divisionId: sp.division }), missingReports(db, actor), listDivisions(db, actor)]);
    const ret = `/app/reports?month=${month}${sp.status ? `&status=${sp.status}` : ""}${sp.division ? `&division=${sp.division}` : ""}`;
    return (
      <>
        <PageHeader title="日報" description="ドライバーが提出した日報を確認して承認します。承認済みの日報だけが稼働明細の対象になります。" />
        <FilterBar>
          <Field label="対象月"><Input type="month" name="month" defaultValue={month} /></Field>
          <Field label="状態"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option>{Object.entries(L.report).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{divisions.filter((d) => d.kind === "DRIVER").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </FilterBar>
        {missing.length > 0 && (
          <Card title={`未提出（確定スケジュールがあるのに日報がない日・直近31日）${missing.length}件`} className="mb-6">
            <Table>
              <thead><tr><Th>稼働日</Th><Th>ドライバー</Th><Th>案件</Th><Th>予定時間</Th></tr></thead>
              <tbody>{missing.map((m) => (
                <tr key={m.assignmentId}><Td>{formatDate(m.workDate)}（{weekdayJa(m.workDate)}）</Td><Td>{m.driverName}</Td><Td>{m.projectCode}</Td><Td className="tabular">{m.start.slice(0, 5)}〜{m.end.slice(0, 5)}</Td></tr>
              ))}</tbody>
            </Table>
          </Card>
        )}
        <Card title={`${month.replace("-", "年")}月の日報（${rows.length}件）`}>
          {rows.length === 0 ? <EmptyState title="日報はありません" /> : (
            <Table>
              <thead><tr><Th>稼働日</Th><Th>ドライバー</Th><Th>案件</Th><Th>時間</Th><Th>数量</Th><Th>添付</Th><Th>状態</Th><Th /></tr></thead>
              <tbody>{rows.map(({ r, driverName, projectCode, reportFields, fileCount }) => (
                <tr key={r.id}>
                  <Td><Link className="text-navy-700 underline" href={`/app/reports/${r.id}`}>{formatDate(r.workDate)}（{weekdayJa(r.workDate)}）</Link></Td>
                  <Td>{driverName}</Td>
                  <Td>{projectCode}</Td>
                  <Td className="tabular">{r.startTime.slice(0, 5)}〜{r.endTime.slice(0, 5)}{r.breakMinutes ? `（休${r.breakMinutes}分）` : ""}</Td>
                  <Td className="tabular">{r.quantity ? `${Number(r.quantity)}${reportFields.quantityUnit}` : "—"}</Td>
                  <Td>{fileCount || "—"}</Td>
                  <Td><Badge tone={L.report[r.status][1]}>{L.report[r.status][0]}</Badge>{r.version > 1 && <Badge tone="info">訂正{r.version - 1}回</Badge>}</Td>
                  <Td>{r.status === "SUBMITTED" && <ReportDecision id={r.id} returnTo={ret} />}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </>
    );
  });
}
