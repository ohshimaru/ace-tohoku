"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, formObject, runAction, runAndRedirect, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { addCommitment, archiveRule, cancelCommitment, decideBudgetRequest, requestBudget, saveRule } from "@/server/budget";

const done = () => revalidatePath("/app/budget");

export async function saveRuleAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const o = formObject(fd);
    await saveRule(getDb(), await requireActorForAction(), o.id || null, { ...(o as Record<string, string>), carryOver: o.carryOver === "1" } as never);
    done();
    return "予算ルールを保存しました";
  });
}

export async function archiveRuleAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await archiveRule(getDb(), await requireActorForAction(), str(fd, "id"));
    return "saved";
  }, () => "/app/budget");
}

export async function addCommitmentAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await addCommitment(getDb(), await requireActorForAction(), formObject(fd) as never);
    done();
    return "発注済み費用を登録しました（予約額に入ります）";
  });
}

export async function cancelCommitmentAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await cancelCommitment(getDb(), await requireActorForAction(), str(fd, "id"));
    return "canceled";
  }, () => "/app/budget");
}

export async function requestBudgetAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await requestBudget(getDb(), await requireActorForAction(), formObject(fd) as never);
    done();
    return "予算追加を申請しました";
  });
}

export async function decideBudgetRequestAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    const approve = str(fd, "decision") === "approve";
    await decideBudgetRequest(getDb(), await requireActorForAction(), str(fd, "id"), approve, str(fd, "note"));
    return approve ? "approved" : "rejected";
  }, () => "/app/approvals");
}
