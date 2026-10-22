"use server";

import { getDb } from "@/db";
import { type ActionResult, runAndRedirect, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { closeMonth, reopenMonth } from "@/server/months";

export async function closeMonthAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await closeMonth(getDb(), await requireActorForAction(), str(fd, "month"));
    return "closed";
  }, () => "/app/months");
}
export async function reopenMonthAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await reopenMonth(getDb(), await requireActorForAction(), str(fd, "month"), str(fd, "reason"));
    return "reopened";
  }, () => "/app/months");
}
