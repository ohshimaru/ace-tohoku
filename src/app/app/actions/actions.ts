"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { refreshActionCards, setActionAssignee, setActionStatus } from "@/server/actions-engine";
import { sendDailyDigest } from "@/server/digest";
import { forbidden, invalid } from "@/lib/errors";

export async function setActionStatusAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await setActionStatus(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "status") as "DONE");
    revalidatePath("/app/actions");
    revalidatePath("/app/tasks");
    revalidatePath("/app");
    return "更新しました";
  });
}

export async function refreshCardsAction() {
  return runAction(async () => {
    const r = await refreshActionCards(getDb(), await requireActorForAction());
    revalidatePath("/app/actions");
    revalidatePath("/app");
    return `確認しました（新しい指摘 ${r.created}件、解消 ${r.resolved}件）`;
  });
}

export async function assignAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await setActionAssignee(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "userId") || null);
    revalidatePath("/app/tasks");
    return "担当者を設定しました";
  });
}

export async function testSlackAction() {
  return runAction(async () => {
    const a = await requireActorForAction();
    if (a.role !== "OWNER") throw forbidden("Slack の送信テストは経営者のみ行えます");
    const r = await sendDailyDigest(getDb(), { test: true });
    if (r.status === "NOT_CONFIGURED") return "Slack の送信先がまだ設定されていません（SLACK_WEBHOOK_URL）";
    if (r.status === "ALREADY_SENT") return "1分以内に送信済みです。少し待ってから試してください";
    if (r.status === "FAILED") throw invalid(`送信できませんでした: ${r.error}`);
    revalidatePath("/app/tasks");
    return "Slack に要約を送信しました。チャンネルを確認してください";
  });
}
