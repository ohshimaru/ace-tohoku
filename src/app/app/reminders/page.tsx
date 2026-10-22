import { ActionForm } from "@/components/action-form";
import { ConnBadge } from "@/components/conn-badge";
import { Badge, Card, EmptyState, Field, FilterBar, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { guard } from "@/lib/page-guard";
import { requireStaff } from "@/lib/session";
import { connectionStatus } from "@/server/integrations";
import { listOutbox, listReminderRules } from "@/server/mailer";
import { retryAction, runNowAction, saveRulesAction } from "./actions";

export const metadata = { title: "メール送信" };

const ST: Record<string, [string, "info" | "ok" | "neutral" | "bad"]> = { QUEUED: ["送信待ち", "info"], SENT: ["送信済み", "ok"], SKIPPED: ["送信不要", "neutral"], FAILED: ["失敗", "bad"] };
const KIND: Record<string, string> = { AVAILABILITY_REMINDER: "稼働希望リマインド", INVITE: "招待", EMAIL_VERIFY: "メール確認" };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  return guard(async () => {
    const db = getDb();
    const [rules, rows] = await Promise.all([listReminderRules(db), listOutbox(db, actor, { status: sp.status })]);
    const email = (await connectionStatus(db)).find((c) => c.key === "email")!;
    const editable = actor.role === "OWNER" || actor.role === "MANAGER";
    const slots = [...rules, ...Array.from({ length: Math.max(0, 6 - rules.length) }, () => null)];
    return (
      <>
        <PageHeader title="メール送信（リマインド）" description="稼働希望を未提出のドライバーにだけ、メール確認済みのアドレスへ送ります。提出済み・停止中・受付終了の人には送りません（送信直前にも確認）。同じ月・同じ人・同じタイミングのメールは1通だけです。LINEへのメッセージ送信は行いません。" actions={<span className="flex items-center gap-2 text-sm">メール: <ConnBadge state={email.state} /></span>} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="送信タイミング（締切日からの日数）">
            <ActionForm action={saveRulesAction} submitLabel="保存" submitVariant="secondary">
              <Table>
                <thead><tr><Th>締切の</Th><Th>時刻</Th><Th>有効</Th></tr></thead>
                <tbody>{slots.map((r, i) => (
                  <tr key={i}>
                    <Td><Select name="offsetDays" defaultValue={r ? String(r.offsetDays) : ""} disabled={!editable} className="w-28"><option value="">（なし）</option>{[-7, -5, -3, -2, -1, 0, 1, 2, 3].map((d) => <option key={d} value={d}>{d < 0 ? `${-d}日前` : d === 0 ? "当日" : `${d}日後`}</option>)}</Select></Td>
                    <Td><Select name="hour" defaultValue={String(r?.hour ?? 9)} disabled={!editable} className="w-20">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}時</option>)}</Select></Td>
                    <Td><input type="checkbox" name="enabled" value={i} defaultChecked={r?.enabled ?? true} disabled={!editable} className="h-4 w-4" aria-label="有効" /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            </ActionForm>
            {actor.role === "OWNER" && (
              <div className="mt-4 border-t border-line pt-4">
                <ActionForm action={runNowAction} submitLabel="定期処理を今すぐ実行" submitVariant="ghost" />
                <p className="mt-1 text-xs text-muted">通常は定期実行（cron）で自動的に動きます。何度実行しても重複送信しません。</p>
              </div>
            )}
          </Card>
          <Card title="送信履歴" className="lg:col-span-2">
            <FilterBar><Field label="状態"><Select name="status" defaultValue={sp.status ?? ""}><option value="">すべて</option>{Object.entries(ST).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</Select></Field></FilterBar>
            {rows.length === 0 ? <EmptyState title="送信履歴はありません" /> : (
              <Table>
                <thead><tr><Th>作成</Th><Th>種類</Th><Th>宛先</Th><Th>件名</Th><Th>状態</Th><Th>試行</Th><Th /></tr></thead>
                <tbody>{rows.map(({ m, toName }) => (
                  <tr key={m.id}>
                    <Td className="text-xs">{formatDateTime(m.createdAt)}</Td>
                    <Td className="text-xs">{KIND[m.kind] ?? m.kind}</Td>
                    <Td>{toName ?? "—"}</Td>
                    <Td className="text-xs">{m.subject}</Td>
                    <Td><Badge tone={ST[m.status][1]}>{ST[m.status][0]}</Badge>{m.lastError && <p className="text-xs text-muted">{m.lastError}</p>}{m.sentAt && <p className="text-xs">{formatDateTime(m.sentAt)}</p>}</Td>
                    <Td className="tabular">{m.attempts}</Td>
                    <Td>{m.status === "FAILED" && <ActionForm action={retryAction} inline submitLabel="再試行" submitVariant="secondary"><input type="hidden" name="id" value={m.id} /></ActionForm>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
        </div>
      </>
    );
  });
}
