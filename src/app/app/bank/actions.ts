"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { archiveBankAccount, classifyTransaction, createBankAccount, importBankCsv, matchPayable, matchReceipt, receiveFromTxn, syncBankAccount, unmatch } from "@/server/bank";

export async function createAccountAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await createBankAccount(getDb(), await requireActorForAction(), { bankName: str(fd, "bankName"), branchName: str(fd, "branchName"), accountType: str(fd, "accountType") as never, accountNumberLast4: str(fd, "last4"), holderName: str(fd, "holderName"), provider: str(fd, "provider") as never, openingBalance: str(fd, "openingBalance") });
    revalidatePath("/app/bank");
    return "口座を登録しました";
  });
}
export async function archiveAccountAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await archiveBankAccount(getDb(), await requireActorForAction(), str(fd, "id"));
    return "saved";
  }, () => "/app/bank");
}
export async function syncAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const r = await syncBankAccount(getDb(), await requireActorForAction(), str(fd, "id"));
    revalidatePath("/app/bank");
    return `同期しました（新規 ${r.imported}件・既存 ${r.skipped}件）`;
  });
}
export async function importCsvAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || f.size === 0) throw invalid("CSVファイルを選んでください");
    if (f.size > 5 * 1024 * 1024) throw invalid("CSVは5MB以下にしてください");
    const r = await importBankCsv(getDb(), await requireActorForAction(), str(fd, "id"), f.name, await f.text());
    revalidatePath("/app/bank");
    return `取り込みました（新規 ${r.imported}件・取込済み ${r.skipped}件）`;
  });
}
const back = (fd: FormData) => `/app/bank/${str(fd, "txnId")}`;
export async function matchReceiptAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await matchReceipt(getDb(), await requireActorForAction(), str(fd, "txnId"), str(fd, "receiptId"));
    return "matched";
  }, () => back(fd));
}
export async function receiveAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    const amt = str(fd, "amount").replace(/,/g, "");
    await receiveFromTxn(getDb(), await requireActorForAction(), str(fd, "txnId"), str(fd, "saleId"), amt ? Number(amt) : undefined);
    return "matched";
  }, () => back(fd));
}
export async function matchPayableAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await matchPayable(getDb(), await requireActorForAction(), str(fd, "txnId"), str(fd, "payableId"));
    return "matched";
  }, () => back(fd));
}
export async function unmatchAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await unmatch(getDb(), await requireActorForAction(), str(fd, "matchId"), str(fd, "reason"));
    return "unmatched";
  }, () => back(fd));
}
export async function classifyAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await classifyTransaction(getDb(), await requireActorForAction(), str(fd, "txnId"), str(fd, "classification"), str(fd, "note"));
    return "saved";
  }, () => back(fd));
}
