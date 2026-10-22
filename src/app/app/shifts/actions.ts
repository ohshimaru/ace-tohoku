"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { addDays, DATE_RE } from "@/lib/dates";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { assignManually, autoAssign, cancelSlot, closePeriod, confirmAssignments, createSlots, decideChangeRequest, openPeriod, unassign } from "@/server/shifts";

const back = (fd: FormData) => `/app/shifts?month=${str(fd, "month")}&division=${str(fd, "divisionId")}`;

export async function openPeriodAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await openPeriod(getDb(), await requireActorForAction(), { month: str(fd, "month"), deadline: str(fd, "deadline"), divisionId: str(fd, "divisionId") || undefined });
    return "saved";
  }, () => back(fd));
}
export async function closePeriodAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await closePeriod(getDb(), await requireActorForAction(), str(fd, "month"));
    return "closed";
  }, () => back(fd));
}

/** 期間と曜日から日付の一覧を作って枠を作成 */
export async function createSlotsAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const from = str(fd, "from");
    const to = str(fd, "to") || from;
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) throw invalid("期間を正しく入力してください");
    const wds = new Set(fd.getAll("wd").map(String));
    const dates: string[] = [];
    for (let d = from; d <= to && dates.length <= 62; d = addDays(d, 1)) if (wds.size === 0 || wds.has(String(new Date(`${d}T12:00:00Z`).getUTCDay()))) dates.push(d);
    const n = await createSlots(getDb(), await requireActorForAction(), {
      projectId: str(fd, "projectId"),
      dates,
      startTime: str(fd, "startTime"),
      endTime: str(fd, "endTime"),
      requiredCount: str(fd, "requiredCount") as never,
      requiredQualifications: str(fd, "requiredQualifications"),
      requiredVehicle: str(fd, "requiredVehicle"),
      area: str(fd, "area"),
      note: str(fd, "note"),
    });
    revalidatePath("/app/shifts");
    return `稼働枠を${n}日分作成しました`;
  });
}

export async function cancelSlotAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await cancelSlot(getDb(), await requireActorForAction(), str(fd, "slotId"));
    return "canceled";
  }, () => back(fd));
}

export async function autoAssignAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const r = await autoAssign(getDb(), await requireActorForAction(), { month: str(fd, "month"), divisionId: str(fd, "divisionId") });
    revalidatePath("/app/shifts");
    const short = r.unfilled.reduce((t, u) => t + u.missing, 0);
    return `下書きの割当を${r.created}件作成しました。${short ? `不足 ${short}人（${r.unfilled.length}枠）。理由は各枠に表示しています。` : "すべての枠が埋まりました。"}内容を確認してから「確定」してください（まだドライバーには表示されません）`;
  });
}

export async function assignAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await assignManually(getDb(), await requireActorForAction(), str(fd, "slotId"), str(fd, "driverId"));
    return "assigned";
  }, () => back(fd));
}

export async function unassignAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await unassign(getDb(), await requireActorForAction(), str(fd, "assignmentId"), str(fd, "reason"));
    return "canceled";
  }, () => back(fd));
}

export async function confirmAssignmentsAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    const n = await confirmAssignments(getDb(), await requireActorForAction(), { month: str(fd, "month"), divisionId: str(fd, "divisionId") });
    if (n === 0) throw invalid("確定する下書きの割当がありません");
    return "confirmed";
  }, () => back(fd));
}

export async function decideChangeAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await decideChangeRequest(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "decision") === "approve");
    return str(fd, "decision") === "approve" ? "approved" : "rejected";
  }, () => back(fd));
}
