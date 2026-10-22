"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { forbidden } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { runScheduledJobs } from "@/server/cron";
import { retryEmail, saveReminderRules } from "@/server/mailer";

export async function saveRulesAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const offsets = fd.getAll("offsetDays").map(String);
    const hours = fd.getAll("hour").map(String);
    const enabled = new Set(fd.getAll("enabled").map(String));
    const rows = offsets.flatMap((o, i) => (o === "" ? [] : [{ offsetDays: Number(o), hour: Number(hours[i]), enabled: enabled.has(String(i)) }]));
    await saveReminderRules(getDb(), await requireActorForAction(), rows);
    revalidatePath("/app/reminders");
    return "リマインドのタイミングを保存しました";
  });
}

export async function retryAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await retryEmail(getDb(), await requireActorForAction(), str(fd, "id"));
    return "sent";
  }, () => "/app/reminders");
}

/** 定期処理を今すぐ実行（経営者のみ。通常は定期実行） */
export async function runNowAction() {
  return runAction(async () => {
    const a = await requireActorForAction();
    if (a.role !== "OWNER") throw forbidden();
    const r = await runScheduledJobs(getDb());
    revalidatePath("/app/reminders");
    return `リマインド予約 ${r.reminders.queued}通・送信 ${r.mail.sent}通・送信不要 ${r.mail.skipped}通・再試行待ち ${r.mail.retried}通・失敗 ${r.mail.failed}通`;
  });
}
