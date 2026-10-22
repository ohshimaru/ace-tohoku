"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { approveReport, correctApprovedReport, returnReport } from "@/server/reports";

const back = (fd: FormData) => {
  const rt = str(fd, "returnTo");
  return rt === "/app/approvals" || rt.startsWith("/app/reports") ? rt : "/app/reports";
};

export async function approveReportAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await approveReport(getDb(), await requireActorForAction(), str(fd, "id"));
    return "approved";
  }, () => back(fd));
}
export async function returnReportAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await returnReport(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "reason"));
    return "returned";
  }, () => back(fd));
}
export async function correctReportAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAction(async () => {
    await correctApprovedReport(getDb(), await requireActorForAction(), id, { workDate: str(fd, "workDate"), projectId: str(fd, "projectId"), startTime: str(fd, "startTime"), endTime: str(fd, "endTime"), breakMinutes: str(fd, "breakMinutes"), quantity: str(fd, "quantity"), distanceKm: str(fd, "distanceKm"), notes: str(fd, "notes") }, str(fd, "reason"));
    revalidatePath(`/app/reports/${id}`);
    return "訂正しました。訂正前の内容は履歴に残っています";
  });
}
