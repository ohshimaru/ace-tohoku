import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, FilterBar, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { formatDateTime } from "@/lib/dates";
import { L } from "@/lib/labels";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { listDrivers } from "@/server/drivers";
import { listDivisions } from "@/server/masters";
import { partnerOptions } from "@/server/partners";
import { inviteDriverAction } from "./actions";

export const metadata = { title: "ドライバー" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ division?: string; status?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const [rows, divisions, partners] = await Promise.all([listDrivers(db, actor, { divisionId: sp.division, status: sp.status }), listDivisions(db, actor), partnerOptions(db, actor, "contractor")]);
    const drvDivs = divisions.filter((d) => d.kind === "DRIVER");
    return (
      <>
        <PageHeader title="ドライバー（業務委託）" description="招待リンクから本人がLINEでログインすると「承認待ち」になります。承認すると利用開始、停止すると即時にログインできなくなります。名前やメールでの自動紐付けは行いません。" />
        <FilterBar>
          <Field label="事業部"><Select name="division" defaultValue={sp.division ?? ""}><option value="">すべて</option>{drvDivs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="状態"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option>{Object.entries(L.userStatus).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </FilterBar>
        <Card title={`${rows.length}人`}>
          {rows.length === 0 ? <EmptyState title="ドライバーがいません">下の「ドライバーを招待」から登録してください。</EmptyState> : (
            <Table>
              <thead><tr><Th>氏名</Th><Th>事業部</Th><Th>状態</Th><Th>LINE</Th><Th>メール</Th><Th>資格・車両</Th><Th>最終ログイン</Th></tr></thead>
              <tbody>{rows.map(({ u, d, divisionName }) => (
                <tr key={u.id}>
                  <Td><Link className="font-bold text-navy-700 underline" href={`/app/drivers/${u.id}`}>{u.name}</Link></Td>
                  <Td>{divisionName}</Td>
                  <Td><Badge tone={L.userStatus[u.status][1]}>{L.userStatus[u.status][0]}</Badge></Td>
                  <Td>{u.lineLinked ? "連携済み" : <span className="text-muted">未連携</span>}</Td>
                  <Td>{u.email ? <>{u.email}{u.emailVerifiedAt ? <Badge tone="ok">確認済み</Badge> : <Badge tone="warn">未確認</Badge>}</> : <span className="text-muted">未登録</span>}</Td>
                  <Td className="text-xs">{[...d.qualifications, ...d.vehicles].join("、") || "—"}</Td>
                  <Td className="text-xs">{formatDateTime(u.lastLoginAt)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        {can.manageDrivers(actor) && (
          <Card title="ドライバーを招待" className="mt-6">
            {drvDivs.length === 0 ? <EmptyState title="業務委託（ドライバー）の事業部がありません">設定 → 事業部 で種類「業務委託（ドライバー）」の事業部を作成してください。</EmptyState> : (
              <ActionForm action={inviteDriverAction} submitLabel="招待リンクを作成" resetOnSuccess>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="氏名" required><Input name="name" required maxLength={100} /></Field>
                  <Field label="事業部" required><Select name="divisionId" required defaultValue={drvDivs.length === 1 ? drvDivs[0].id : ""}><option value="">選択</option>{drvDivs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                  <Field label="メール（任意）" hint="入力すると招待メールを送ります。リマインド用には本人の確認が別途必要です"><Input type="email" name="email" /></Field>
                  <Field label="電話（任意）"><Input name="phone" maxLength={30} /></Field>
                  <Field label="委託先の取引先（任意）"><Select name="partnerId" defaultValue=""><option value="">（なし）</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                </div>
              </ActionForm>
            )}
          </Card>
        )}
      </>
    );
  });
}
