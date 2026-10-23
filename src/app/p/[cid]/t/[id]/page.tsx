import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DefList, EmptyState, Field, Grid, Input, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { CONFIRM_LABEL, PUBLISH_LABEL } from "@/lib/disclosure";
import { L } from "@/lib/labels";
import { formatYen } from "@/lib/money";
import { guard } from "@/lib/page-guard";
import { requireProvider } from "@/lib/session";
import { getTransaction, matchCandidates } from "@/server/bank";
import { audienceOptions, providerGetTxn } from "@/server/provider-finance";
import { addCorrectionAction, matchPayableAction, matchReceiptAction, receiveAction, setExcludedAction, setTxnVisibilityAction, unmatchAction, updateMetaAction } from "../../../actions";

export const metadata = { title: "取引の詳細" };

export default async function ProviderTxnPage({ params }: { params: Promise<{ cid: string; id: string }> }) {
  const actor = await requireProvider();
  const { cid, id } = await params;
  return guard(async () => {
    const db = getDb();
    const x = await providerGetTxn(db, actor, id);
    if (x.company.id !== cid) notFound();
    const [opts, bank, cand] = await Promise.all([audienceOptions(db, actor, cid), getTransaction(db, actor, id), matchCandidates(db, actor, id)]);
    const t = x.t;
    const h = (
      <>
        <input type="hidden" name="companyId" value={cid} />
        <input type="hidden" name="txnId" value={t.id} />
      </>
    );
    const audUsers = new Set(x.audience.filter((a) => a.kind === "USER").map((a) => a.target_id));
    const audDivs = new Set(x.audience.filter((a) => a.kind === "DIVISION").map((a) => a.target_id));
    return (
      <>
        <PageHeader title={`${formatDate(t.eff_date)}　${t.eff_amount > 0 ? "入金" : "出金"} ${formatYen(Math.abs(t.eff_amount))}`} back={{ href: `/p/${cid}`, label: "入出金と公開状況" }} actions={<>{t.is_demo && <Badge tone="warn">デモ</Badge>}<Badge tone={t.publish_status === "PUBLISHED" ? "ok" : t.publish_status === "SUSPENDED" ? "bad" : "neutral"}>{PUBLISH_LABEL[t.publish_status]}</Badge></>} />
        <Grid>
          <Card title="原本（銀行から取得した値・変更できません）">
            <DefList items={[["口座", t.account], ["取得元", t.source === "MANUAL" ? "手動登録" : t.source], ["日付", formatDate(t.original_date)], ["金額", `${t.original_amount > 0 ? "入金" : "出金"} ${formatYen(Math.abs(t.original_amount))}`], ["内容", t.original_description], ["取引後残高", t.balance_after == null ? "—" : formatYen(t.balance_after)]]} />
            {x.corrections.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-sm font-bold">訂正の記録（新しい順。最新の訂正が表示・集計に使われます）</p>
                <ul className="space-y-1 text-sm">{x.corrections.map((c) => <li key={c.id} className="rounded border border-line p-2">{formatDate(c.txn_date)}・{c.amount > 0 ? "入金" : "出金"} {formatYen(Math.abs(c.amount))}・{c.description}<div className="text-xs text-muted">理由: {c.reason}／{c.by ?? "—"}・{formatDateTime(c.created_at)}</div></li>)}</ul>
              </div>
            )}
          </Card>
          <Card title="1. 表示先（本社・スタッフへの公開）">
            <ActionForm action={setTxnVisibilityAction} submitLabel="表示先を保存" className="space-y-3">
              {h}
              <Field label="公開状態"><Select name="status" defaultValue={t.publish_status}><option value="DRAFT">下書き（提供者のみ）</option><option value="PUBLISHED">公開中</option><option value="SUSPENDED">公開停止</option></Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="本社に"><Select name="hq" defaultValue={t.hq_visible ? "1" : "0"}><option value="1">公開する</option><option value="0">公開しない</option></Select></Field>
                <Field label="スタッフに"><Select name="staff" defaultValue={t.staff_visible ? "1" : "0"}><option value="1">公開する</option><option value="0">公開しない</option></Select></Field>
              </div>
              <fieldset className="rounded border border-line p-2 text-sm"><legend className="px-1 text-xs font-bold">スタッフへの公開対象</legend>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {opts.staff.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="audUser" value={s.id} defaultChecked={audUsers.has(s.id)} />{s.name}<span className="text-xs text-muted">{s.division}</span></label>)}
                  {opts.divisions.map((v) => <label key={v.id} className="flex items-center gap-2"><input type="checkbox" name="audDivision" value={v.id} defaultChecked={audDivs.has(v.id)} />事業部: {v.name}</label>)}
                  {opts.staff.length + opts.divisions.length === 0 && <p className="text-xs text-muted">公開対象にできるスタッフ・事業部がありません</p>}
                </div>
              </fieldset>
              <p className="text-xs text-muted">スタッフには、「公開権限」で明細の閲覧を許可した人だけに表示されます（事業部あての公開も同じ）。本社公開とスタッフ公開は別々の設定です（一方を公開しても、もう一方には公開されません）。公開停止にすると、以後は本社・スタッフの画面・CSV出力から取得できなくなります。</p>
            </ActionForm>
          </Card>
        </Grid>
        <Grid>
          <Card title="2. 分類・メモ・確認状態" className="mt-6">
            <ActionForm action={updateMetaAction} submitLabel="保存" submitVariant="secondary" className="space-y-3">
              {h}
              <div className="grid grid-cols-2 gap-3">
                <Field label="分類"><Select name="classification" defaultValue={t.classification}>{Object.entries(L.bankClass).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="確認状態"><Select name="confirmStatus" defaultValue={t.confirm_status}>{Object.entries(CONFIRM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              </div>
              {x.company.is_self && opts.projects.length > 0 && <Field label="案件"><Select name="projectId" defaultValue={t.project_id ?? ""}><option value="">なし</option>{opts.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
              <Field label="メモ" hint="提供者だけが見るメモです（本社・スタッフには表示されません）"><Input name="note" defaultValue={t.note ?? ""} maxLength={300} /></Field>
            </ActionForm>
          </Card>
          <Card title="3. 訂正を追加（原本は残ります）" className="mt-6">
            <ActionForm action={addCorrectionAction} submitLabel="訂正を追加" submitVariant="secondary" className="space-y-3" resetOnSuccess>
              {h}
              <div className="grid grid-cols-2 gap-3">
                <Field label="日付" required><Input type="date" name="txnDate" defaultValue={t.eff_date} required /></Field>
                <Field label="入出金" required><Select name="direction" defaultValue={t.eff_amount > 0 ? "in" : "out"}><option value="in">入金</option><option value="out">出金</option></Select></Field>
                <Field label="金額（円）" required><Input name="amount" inputMode="numeric" defaultValue={Math.abs(t.eff_amount)} required /></Field>
                <Field label="内容" required><Input name="description" defaultValue={t.eff_description} maxLength={200} required /></Field>
              </div>
              <Field label="訂正の理由" required><Input name="reason" maxLength={300} required /></Field>
            </ActionForm>
          </Card>
        </Grid>
        <Grid>
          <Card title="4. 集計対象（重複・誤取込の除外）" className="mt-6">
            <p className="mb-2 text-sm">現在: {t.excluded ? <><Badge>集計対象外</Badge> {t.exclude_reason}</> : "集計対象"}</p>
            <ActionForm action={setExcludedAction} submitLabel={t.excluded ? "集計対象に戻す" : "集計対象外にする"} submitVariant={t.excluded ? "secondary" : "danger"} className="space-y-2">
              {h}
              <input type="hidden" name="excluded" value={t.excluded ? "0" : "1"} />
              <Field label="理由" required={!t.excluded}><Input name="reason" maxLength={300} required={!t.excluded} placeholder="例: 同じ取引をCSVで二重に取り込んだため" /></Field>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">集計対象外は「非公開」とは別の設定です。原本は残り、どの合計にも含まれなくなります（一覧では「集計対象外」と表示）。</p>
          </Card>
          <Card title="売上・支払予定との照合" className="mt-6">
            {!x.company.is_self ? <p className="text-sm text-muted">この会社の売上・支払予定はこのシステムで管理していないため、照合はありません。</p> : (
              <>
                {bank.matches.length === 0 ? <p className="text-sm text-muted">まだ照合されていません。未照合額 {formatYen(bank.remaining)}</p> : (
                  <ul className="space-y-2 text-sm">{bank.matches.map((m) => (
                    <li key={m.id} className={m.unmatched_at ? "text-muted line-through" : ""}>
                      {m.target_type === "RECEIPT" ? "入金記録" : "支払予定"}: {m.label} {formatYen(m.amount)}
                      {!m.unmatched_at && <ActionForm action={unmatchAction} inline submitLabel="解除" submitVariant="ghost">{h}<input type="hidden" name="matchId" value={m.id} /><Input name="reason" placeholder="解除の理由" required className="w-36" /></ActionForm>}
                    </li>
                  ))}</ul>
                )}
                {bank.remaining > 0 && t.eff_amount > 0 && (cand.receipts.length + cand.sales.length > 0) && (
                  <Table>
                    <thead><tr><Th>候補</Th><Th className="text-right">金額</Th><Th /></tr></thead>
                    <tbody>
                      {cand.receipts.map((r) => <tr key={r.id}><Td>入金記録 {formatDate(r.received_on)} {r.description}<div className="text-xs text-muted">{r.customer}</div></Td><Td className="tabular text-right">{formatYen(r.amount)}</Td><Td><ActionForm action={matchReceiptAction} inline submitLabel="照合" submitVariant="secondary">{h}<input type="hidden" name="receiptId" value={r.id} /></ActionForm></Td></tr>)}
                      {cand.sales.map((s) => <tr key={s.id}><Td>未収の売上 {s.description}<div className="text-xs text-muted">{s.customer} / {s.month}</div></Td><Td className="tabular text-right">{formatYen(s.rest)}</Td><Td><ActionForm action={receiveAction} inline submitLabel="入金登録・照合" submitVariant="secondary">{h}<input type="hidden" name="saleId" value={s.id} /><Input name="amount" defaultValue={Math.min(s.rest, bank.remaining)} className="w-28" inputMode="numeric" /></ActionForm></Td></tr>)}
                    </tbody>
                  </Table>
                )}
                {bank.remaining > 0 && t.eff_amount < 0 && cand.payables.length > 0 && (
                  <Table>
                    <thead><tr><Th>支払予定</Th><Th className="text-right">金額</Th><Th /></tr></thead>
                    <tbody>{cand.payables.map((p) => <tr key={p.id}><Td>{formatDate(p.due_date)} {p.payee_name}<div className="text-xs text-muted">{p.description}</div></Td><Td className="tabular text-right">{formatYen(p.amount)}</Td><Td><ActionForm action={matchPayableAction} inline submitLabel="照合" submitVariant="secondary">{h}<input type="hidden" name="payableId" value={p.id} /></ActionForm></Td></tr>)}</tbody>
                  </Table>
                )}
              </>
            )}
          </Card>
        </Grid>
        <Card title="この取引の操作履歴" className="mt-6">
          {x.history.length === 0 ? <EmptyState title="操作履歴はありません" /> : (
            <Table>
              <thead><tr><Th>日時</Th><Th>実行者</Th><Th>内容</Th><Th>変更前 → 変更後</Th></tr></thead>
              <tbody>{x.history.map((l) => <tr key={l.id}><Td className="whitespace-nowrap text-xs">{formatDateTime(l.at)}</Td><Td>{l.actor_name}</Td><Td>{l.summary}</Td><Td className="max-w-md break-all text-xs text-muted">{l.changes ? JSON.stringify(l.changes) : ""}</Td></tr>)}</tbody>
            </Table>
          )}
          <Notice tone="info">最終変更: {t.updated_by ?? "—"}（{formatDateTime(t.updated_at)}）</Notice>
        </Card>
      </>
    );
  });
}
