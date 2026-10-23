"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { applyVisibilityAction, previewBulkAction } from "@/app/p/actions";
import { CONFIRM_LABEL, PUBLISH_LABEL } from "@/lib/disclosure";
import { L } from "@/lib/labels";
import { Badge, Button, Notice, Select } from "./ui";

export type Row = {
  id: string;
  account: string;
  is_demo: boolean;
  source: string;
  original_date: string;
  original_amount: number;
  original_description: string;
  eff_date: string;
  eff_amount: number;
  eff_description: string;
  corrected: boolean;
  classification: string;
  confirm_status: string;
  publish_status: string;
  hq_visible: boolean;
  staff_visible: boolean;
  excluded: boolean;
  audience: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

const yen = (n: number) => `${Math.abs(n).toLocaleString()}円`;
const d = (s: string) => s.replaceAll("-", "/");
const init = { ok: false, message: "", at: 0 } as { ok: boolean; message: string; at: number; data?: Record<string, string> };

function Submit({ label, variant = "primary", formAction, onClick }: { label: string; variant?: "primary" | "secondary"; formAction: (fd: FormData) => void; onClick?: () => void }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} formAction={formAction} onClick={onClick} disabled={pending}>{pending ? "処理中…" : label}</Button>;
}

/** 提供者の入出金一覧（原本と公開状況）と一括の表示先変更（確認してから実行） */
export function ProviderTxnTable({ cid, rows, filterJson, staff, divisions }: { cid: string; rows: Row[]; filterJson: string; staff: { id: string; name: string; division: string | null }[]; divisions: { id: string; name: string }[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"ids" | "filter">("ids");
  const [setAud, setSetAud] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pState, preview] = useActionState(previewBulkAction, init);
  const [aState, apply] = useActionState(applyVisibilityAction, init);
  const applied = aState.ok && aState.at >= pState.at;
  const confirmed = pState.ok && !dirty && !applied ? pState.data : undefined;
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
    setDirty(true);
  };
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  return (
    <form onChange={() => setDirty(true)} className="space-y-4">
      <input type="hidden" name="companyId" value={cid} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="filter" value={filterJson} />
      {mode === "ids" && [...sel].map((id) => <input key={id} type="hidden" name="id" value={id} />)}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-navy-50 text-left text-[0.8rem] text-navy-800">
            <tr>
              <th className="px-2 py-2"><input type="checkbox" aria-label="すべて選択" checked={all} onChange={() => { setSel(all ? new Set() : new Set(rows.map((r) => r.id))); setDirty(true); }} /></th>
              <th className="px-2 py-2">日付（原本）</th>
              <th className="px-2 py-2">内容（原本）</th>
              <th className="px-2 py-2 text-right">入金</th>
              <th className="px-2 py-2 text-right">出金</th>
              <th className="px-2 py-2">口座・取得元</th>
              <th className="px-2 py-2">区分・確認</th>
              <th className="px-2 py-2">公開状態</th>
              <th className="px-2 py-2">本社公開</th>
              <th className="px-2 py-2">スタッフ公開</th>
              <th className="px-2 py-2">公開対象</th>
              <th className="px-2 py-2">最終変更者</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-line align-top ${r.excluded ? "text-muted" : ""}`}>
                <td className="px-2 py-2"><input type="checkbox" aria-label="選択" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="tabular whitespace-nowrap px-2 py-2">{d(r.original_date)}{r.corrected && r.eff_date !== r.original_date && <div className="text-xs text-warn">訂正: {d(r.eff_date)}</div>}</td>
                <td className="px-2 py-2">
                  <Link className="text-navy-700 underline" href={`/p/${cid}/t/${r.id}`}>{r.original_description}</Link>
                  {r.corrected && <div className="text-xs text-warn">訂正後: {r.eff_description}（{r.eff_amount > 0 ? "入金" : "出金"} {yen(r.eff_amount)}）</div>}
                  {r.excluded && <Badge>集計対象外</Badge>}
                </td>
                <td className="tabular px-2 py-2 text-right text-ok">{r.original_amount > 0 ? yen(r.original_amount) : ""}</td>
                <td className="tabular px-2 py-2 text-right">{r.original_amount < 0 ? yen(r.original_amount) : ""}</td>
                <td className="px-2 py-2 text-xs">{r.account}<div className="text-muted">{r.source === "MANUAL" ? "手動登録" : r.source === "DEMO" ? "デモ" : r.source === "CSV" ? "CSV取込" : r.source}</div></td>
                <td className="px-2 py-2 text-xs">{L.bankClass[r.classification]}<div className={r.confirm_status === "CONFIRMED" ? "text-ok" : r.confirm_status === "NEEDS_REVIEW" ? "text-bad" : "text-muted"}>{CONFIRM_LABEL[r.confirm_status]}</div></td>
                <td className="px-2 py-2"><Badge tone={r.publish_status === "PUBLISHED" ? "ok" : r.publish_status === "SUSPENDED" ? "bad" : "neutral"}>{PUBLISH_LABEL[r.publish_status]}</Badge></td>
                <td className="px-2 py-2 text-xs">{r.hq_visible ? <b className="text-navy-800">公開する</b> : "しない"}</td>
                <td className="px-2 py-2 text-xs">{r.staff_visible ? <b className="text-navy-800">公開する</b> : "しない"}</td>
                <td className="px-2 py-2 text-xs">{r.audience ?? "—"}</td>
                <td className="px-2 py-2 text-xs">{r.updated_by ?? "—"}{r.updated_at && <div className="text-muted">{r.updated_at.slice(0, 16)}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">「公開状態」が「公開中」で、かつ「本社公開」または「スタッフ公開（公開対象あり）」のときだけ、その相手に表示されます。本社に公開してもスタッフには公開されません（別々の設定です）。</p>

      <section className="rounded-lg border border-navy-200 bg-navy-50/50 p-4">
        <h2 className="mb-3 text-sm font-bold text-navy-900">表示先をまとめて変更</h2>
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "ids"} onChange={() => { setMode("ids"); setDirty(true); }} />選んだ取引（{sel.size}件）</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "filter"} onChange={() => { setMode("filter"); setDirty(true); }} />いまの絞り込み条件に当てはまる取引すべて</label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">公開状態<Select name="status" defaultValue=""><option value="">変更しない</option><option value="DRAFT">下書き</option><option value="PUBLISHED">公開中</option><option value="SUSPENDED">公開停止</option></Select></label>
          <label className="text-sm">本社に<Select name="hq" defaultValue=""><option value="">変更しない</option><option value="1">公開する</option><option value="0">公開しない</option></Select></label>
          <label className="text-sm">スタッフに<Select name="staff" defaultValue=""><option value="">変更しない</option><option value="1">公開する</option><option value="0">公開しない</option></Select></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="setAudience" value="1" checked={setAud} onChange={(e) => setSetAud(e.target.checked)} />スタッフの公開対象を次の内容に置き換える</label>
        {setAud && (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <fieldset className="rounded border border-line bg-white p-2 text-sm"><legend className="px-1 text-xs font-bold">指定スタッフ</legend>
              {staff.length === 0 ? <p className="text-xs text-muted">スタッフがいません</p> : staff.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="audUser" value={s.id} />{s.name}<span className="text-xs text-muted">{s.division}</span></label>)}
            </fieldset>
            <fieldset className="rounded border border-line bg-white p-2 text-sm"><legend className="px-1 text-xs font-bold">事業部（所属スタッフ全員）</legend>
              {divisions.length === 0 ? <p className="text-xs text-muted">事業部がありません</p> : divisions.map((v) => <label key={v.id} className="flex items-center gap-2"><input type="checkbox" name="audDivision" value={v.id} />{v.name}</label>)}
            </fieldset>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Submit label="対象件数と公開先を確認" variant="secondary" formAction={preview} onClick={() => setDirty(false)} />
        </div>
        {!pState.ok && pState.message && <div className="mt-3"><Notice tone="bad">{pState.message}</Notice></div>}
        {confirmed && (
          <div className="mt-4 rounded-lg border border-warn/40 bg-warn-bg p-3 text-sm">
            <p className="font-bold">この内容で変更します。よろしいですか？</p>
            <ul className="mt-1 list-disc pl-5">
              <li>対象: <b>{confirmed.count}件</b></li>
              <li>変更後に本社に表示される件数（対象のうち）: <b>{confirmed.afterHq}件</b></li>
              <li>変更後にスタッフに表示される件数（対象のうち）: <b>{confirmed.afterStaff}件</b></li>
              {confirmed.staffNoAudience !== "0" && <li className="text-bad">スタッフ公開なのに公開対象がない取引が {confirmed.staffNoAudience}件あります（このままでは実行できません。公開対象を選んでください）</li>}
            </ul>
            <input type="hidden" name="ids" value={confirmed.ids} />
            <input type="hidden" name="expectedCount" value={confirmed.count} />
            <div className="mt-3"><Submit label={`${confirmed.count}件を変更する`} formAction={apply} /></div>
          </div>
        )}
        {aState.message && aState.at >= pState.at && <div className="mt-3"><Notice tone={aState.ok ? "ok" : "bad"}>{aState.message}</Notice></div>}
        <p className="mt-3 text-xs text-muted">変更すると、取引ごとに実行者・日時・変更前後の設定が操作履歴に残ります。</p>
      </section>
    </form>
  );
}
