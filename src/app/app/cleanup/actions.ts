"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { importCleanupInvoices } from "@/server/cleanup";

export async function importCleanupAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || f.size === 0) throw invalid("CSVファイルを選んでください");
    if (f.size > 5 * 1024 * 1024) throw invalid("CSVは5MB以下にしてください");
    const r = await importCleanupInvoices(getDb(), await requireActorForAction(), { divisionId: str(fd, "divisionId"), fileName: f.name, text: await f.text(), createCustomers: str(fd, "createCustomers") === "1" });
    revalidatePath("/app/cleanup");
    if (r.errors.length) throw invalid(`取り込めませんでした（何も登録していません）\n${r.errors.join("\n")}`);
    const w = "warnings" in r && r.warnings.length ? `\n注意:\n${r.warnings.slice(0, 20).join("\n")}` : "";
    return `取り込みました: 新規 ${r.created}件・更新 ${r.updated ?? 0}件・変更なし／対象外 ${r.skipped}件${w}`;
  });
}
