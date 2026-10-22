"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { addOtherPayable, markPayablePaid, reopenPayable } from "@/server/sales";

export async function markPaidAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await markPayablePaid(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "paidOn"));
    return "paid";
  }, () => "/app/payables");
}
export async function reopenPayableAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await reopenPayable(getDb(), await requireActorForAction(), str(fd, "id"));
    return "saved";
  }, () => "/app/payables");
}
export async function addPayableAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await addOtherPayable(getDb(), await requireActorForAction(), { payeeName: str(fd, "payeeName"), description: str(fd, "description"), amount: str(fd, "amount"), dueDate: str(fd, "dueDate") });
    revalidatePath("/app/payables");
    return "支払予定を登録しました";
  });
}
