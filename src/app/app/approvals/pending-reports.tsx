import Link from "next/link";
import { ReportDecision } from "@/components/report-decision";
import { Card, EmptyState, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import type { Actor } from "@/lib/access";
import { formatDate, weekdayJa } from "@/lib/dates";
import { pendingReportsForApprover } from "@/server/reports";

/** 日報の承認待ち */
export async function PendingReports({ actor }: { actor: Actor }) {
  const rows = await pendingReportsForApprover(getDb(), actor);
  return (
    <Card title={`日報の承認待ち（${rows.length}件）`} className="mt-6">
      {rows.length === 0 ? <EmptyState title="承認待ちの日報はありません" /> : (
        <Table>
          <thead><tr><Th>稼働日</Th><Th>ドライバー</Th><Th>案件</Th><Th>時間</Th><Th>数量</Th><Th /></tr></thead>
          <tbody>{rows.map(({ r, driverName, projectCode, reportFields }) => (
            <tr key={r.id}>
              <Td><Link className="text-navy-700 underline" href={`/app/reports/${r.id}`}>{formatDate(r.workDate)}（{weekdayJa(r.workDate)}）</Link></Td>
              <Td>{driverName}</Td>
              <Td>{projectCode}</Td>
              <Td className="tabular">{r.startTime.slice(0, 5)}〜{r.endTime.slice(0, 5)}{r.breakMinutes ? `（休${r.breakMinutes}分）` : ""}</Td>
              <Td className="tabular">{r.quantity ? `${Number(r.quantity)}${reportFields.quantityUnit}` : "—"}</Td>
              <Td><ReportDecision id={r.id} returnTo="/app/approvals" /></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </Card>
  );
}
