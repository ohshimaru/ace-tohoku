"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { addAdjustment, addRate, createCorrection, decideAdjustment, generateForDivision, regenerateStatement, replyInquiry, setStatementStatus } from "@/server/statements";

export async function generateAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const r = await generateForDivision(getDb(), await requireActorForAction(), { month: str(fd, "month"), divisionId: str(fd, "divisionId") });
    revalidatePath("/app/statements");
    const w = r.warnings.length ? `\n注意:\n${r.warnings.slice(0, 20).join("\n")}` : "";
    return `新規 ${r.created}件・再生成 ${r.regenerated}件・確定済みのため変更なし ${r.locked}件。内容を確認してから確定してください。${w}`;
  });
}

export async function regenerateAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    await regenerateStatement(getDb(), await requireActorForAction(), id);
    return "generated";
  }, () => `/app/statements/${id}`);
}

export async function statementStatusAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  const to = str(fd, "to");
  return runAndRedirect(async () => {
    if (!["REVIEW", "CONFIRMED", "PUBLISHED", "DRAFT"].includes(to)) throw invalid("不明な操作です");
    await setStatementStatus(getDb(), await requireActorForAction(), id, to as "REVIEW");
    return to === "CONFIRMED" ? "confirmed" : to === "PUBLISHED" ? "published" : "saved";
  }, () => `/app/statements/${id}`);
}

export async function correctionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let next = "";
  const r = await runAction(async () => {
    next = await createCorrection(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "reason"));
  });
  if (r.ok && next) redirect(`/app/statements/${next}?flash=generated`);
  return r;
}

export async function replyAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "statementId");
  return runAndRedirect(async () => {
    await replyInquiry(getDb(), await requireActorForAction(), str(fd, "inquiryId"), str(fd, "reply"));
    return "sent";
  }, () => `/app/statements/${id}`);
}

export async function addRateAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await addRate(getDb(), await requireActorForAction(), { projectId: str(fd, "projectId"), driverId: str(fd, "driverId"), method: str(fd, "method") as never, unitPrice: str(fd, "unitPrice"), unitLabel: str(fd, "unitLabel"), effectiveFrom: str(fd, "effectiveFrom") });
    revalidatePath("/app/statements/rates");
    return "単価を登録しました（同じ案件・対象の直前の単価は前日で終了）";
  });
}

export async function addAdjustmentAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await addAdjustment(getDb(), await requireActorForAction(), { driverId: str(fd, "driverId"), projectId: str(fd, "projectId"), month: str(fd, "month"), amount: str(fd, "amount"), reason: str(fd, "reason") });
    revalidatePath("/app/statements/rates");
    return "調整を登録しました。別の担当者の承認後に明細へ反映されます";
  });
}

export async function decideAdjustmentAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await decideAdjustment(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "decision") === "approve");
    return str(fd, "decision") === "approve" ? "approved" : "rejected";
  }, () => "/app/statements/rates");
}
