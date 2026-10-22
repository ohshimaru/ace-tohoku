"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateFile } from "@/adapters/storage";
import { getDb } from "@/db";
import { type ActionResult, formObject, runAction, runAndRedirect, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { addExpenseFile, approveExpense, cancelExpense, createExpense, rejectExpense, removeExpenseFile, returnExpense, submitExpense, updateExpense } from "@/server/expenses";

async function fileFrom(fd: FormData) {
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > 10 * 1024 * 1024) throw invalid("ファイルは10MB以下にしてください");
  const bytes = new Uint8Array(await f.arrayBuffer());
  validateFile(bytes);
  return { name: f.name, bytes };
}

/** 会社側・ドライバー側の共通。戻り先は returnTo（/app または /d 配下のみ） */
function back(fd: FormData, id: string) {
  const rt = str(fd, "returnTo");
  return rt.startsWith("/d/") ? `/d/expenses/${id}` : `/app/expenses/${id}`;
}

export async function createExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  let flash = "created";
  const r = await runAction(async () => {
    const actor = await requireActorForAction();
    const db = getDb();
    const file = await fileFrom(fd);
    id = await createExpense(db, actor, formObject(fd) as never);
    if (file) await addExpenseFile(db, actor, id, file);
    if (str(fd, "submitNow") === "1") {
      await submitExpense(db, actor, id, { exceptionReason: str(fd, "exceptionReason") });
      flash = "submitted";
    }
  });
  if (r.ok) redirect(`${back(fd, id)}?flash=${flash}`);
  if (id) redirect(`${back(fd, id)}?flash=submit_failed`); // 下書きは保存済み。申請できなかった理由は詳細画面に表示
  return r;
}

export async function updateExpenseAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await updateExpense(getDb(), await requireActorForAction(), str(fd, "id"), formObject(fd) as never);
    revalidatePath(back(fd, str(fd, "id")));
    return "経費を保存しました";
  });
}

export async function expenseOpAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    const actor = await requireActorForAction();
    const db = getDb();
    switch (str(fd, "op")) {
      case "submit":
        await submitExpense(db, actor, id, { exceptionReason: str(fd, "exceptionReason") });
        return "submitted";
      case "approve":
        await approveExpense(db, actor, id);
        return "approved";
      case "return":
        await returnExpense(db, actor, id, str(fd, "reason"));
        return "returned";
      case "reject":
        await rejectExpense(db, actor, id, str(fd, "reason"));
        return "rejected";
      case "cancel":
        await cancelExpense(db, actor, id, str(fd, "reason"));
        return "canceled";
      default:
        throw invalid("不明な操作です");
    }
  }, () => (str(fd, "returnTo") === "/app/approvals" ? "/app/approvals" : back(fd, id)));
}

export async function uploadExpenseFileAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const file = await fileFrom(fd);
    if (!file) throw invalid("ファイルを選んでください");
    await addExpenseFile(getDb(), await requireActorForAction(), str(fd, "id"), file);
    revalidatePath(back(fd, str(fd, "id")));
    return "領収書を添付しました";
  });
}

export async function removeExpenseFileAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await removeExpenseFile(getDb(), await requireActorForAction(), str(fd, "fileId"));
    return "saved";
  }, () => back(fd, str(fd, "id")));
}
