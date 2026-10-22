"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { refreshActionCards, setActionStatus } from "@/server/actions-engine";

export async function setActionStatusAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await setActionStatus(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "status") as "DONE");
    revalidatePath("/app/actions");
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
