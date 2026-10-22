"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { type ActionResult, formObject, runAction, runAndRedirect, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { importSalesCsv } from "@/server/csv";
import { addReceipt, cancelReceipt, cancelSale, createSale, updateSale } from "@/server/sales";

export async function createSaleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    id = await createSale(getDb(), await requireActorForAction(), formObject(fd) as never);
  });
  if (r.ok) redirect(`/app/sales/${id}?flash=created`);
  return r;
}

export async function updateSaleAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await updateSale(getDb(), await requireActorForAction(), str(fd, "id"), formObject(fd) as never);
    revalidatePath(`/app/sales/${str(fd, "id")}`);
    return "売上を保存しました";
  });
}

export async function cancelSaleAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await cancelSale(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "reason"));
    return "canceled";
  }, () => `/app/sales/${str(fd, "id")}`);
}

export async function addReceiptAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    const r = await addReceipt(getDb(), await requireActorForAction(), { saleId: str(fd, "id"), receivedOn: str(fd, "receivedOn"), amount: str(fd, "amount"), note: str(fd, "note"), idempotencyKey: str(fd, "idempotencyKey") });
    return r.duplicated ? "receipt_dup" : "receipt";
  }, () => `/app/sales/${str(fd, "id")}`);
}

export async function cancelReceiptAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await cancelReceipt(getDb(), await requireActorForAction(), str(fd, "receiptId"), str(fd, "reason"));
    return "canceled";
  }, () => `/app/sales/${str(fd, "id")}`);
}

export async function importSalesAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || f.size === 0) throw invalid("CSVファイルを選んでください");
    if (f.size > 2 * 1024 * 1024) throw invalid("CSVは2MB以下にしてください");
    const r = await importSalesCsv(getDb(), await requireActorForAction(), f.name, await f.text());
    revalidatePath("/app/sales");
    if (r.errors.length) throw invalid(`取り込めませんでした（1件も登録していません）: ${r.errors.slice(0, 5).join(" / ")}${r.errors.length > 5 ? ` ほか${r.errors.length - 5}件` : ""}`);
    return `${r.created}件を登録しました（取込済みのためスキップ ${r.skipped}件）`;
  });
}
