"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "./ui";

type RF = { quantity: boolean; quantityUnit: string; distance: boolean; breakTime: boolean; attachments: boolean };
type P = { id: string; code: string; name: string; reportFields: RF };
type V = { workDate?: string; projectId?: string; startTime?: string; endTime?: string; breakMinutes?: number; quantity?: string | null; distanceKm?: string | null; notes?: string };

/** 日報の入力欄。案件の設定に応じて数量・距離・休憩・添付の欄を出し分ける */
export function ReportFields({ projects, v, maxDate, schedule }: { projects: P[]; v: V; maxDate: string; schedule?: string }) {
  const [pid, setPid] = useState(v.projectId ?? (projects.length === 1 ? projects[0].id : ""));
  const rf = projects.find((p) => p.id === pid)?.reportFields;
  return (
    <div className="space-y-3">
      {schedule && <p className="rounded-md bg-navy-50 p-2 text-sm">確定スケジュール: {schedule}（初期値として入力済み）</p>}
      <Field label="稼働日" required><Input type="date" name="workDate" defaultValue={v.workDate} max={maxDate} required /></Field>
      <Field label="案件" required>
        <Select name="projectId" value={pid} onChange={(e) => setPid(e.target.value)} required>
          <option value="">選択してください</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="開始" required><Input type="time" name="startTime" defaultValue={v.startTime?.slice(0, 5)} required /></Field>
        <Field label="終了" required><Input type="time" name="endTime" defaultValue={v.endTime?.slice(0, 5)} required /></Field>
      </div>
      {rf?.breakTime !== false && <Field label="休憩（分）"><Input name="breakMinutes" inputMode="numeric" defaultValue={v.breakMinutes ?? 60} /></Field>}
      {rf?.quantity && <Field label={`実績数量（${rf.quantityUnit}）`} required><Input name="quantity" inputMode="decimal" defaultValue={v.quantity ?? ""} required /></Field>}
      {rf?.distance && <Field label="走行距離（km）"><Input name="distanceKm" inputMode="decimal" defaultValue={v.distanceKm ?? ""} /></Field>}
      <Field label="作業内容・連絡事項"><Textarea name="notes" defaultValue={v.notes ?? ""} rows={3} maxLength={2000} /></Field>
      {rf?.attachments && <Field label="写真・伝票（画像またはPDF・10MBまで）"><Input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></Field>}
    </div>
  );
}
