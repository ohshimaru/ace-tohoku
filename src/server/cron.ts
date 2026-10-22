import "server-only";
import type { DB } from "@/db";
import { refreshActionCards } from "./actions-engine";
import { syncAllAccounts } from "./bank";
import { sendDailyDigest } from "./digest";
import { processOutbox, scheduleAvailabilityReminders } from "./mailer";

/** 定期処理: リマインドの予約 → メール送信（再試行含む） → 自動同期できる口座の同期 → AI行動カードの更新。何度実行しても重複しない */
export async function runScheduledJobs(db: DB, now = new Date()) {
  const reminders = await scheduleAvailabilityReminders(db, now);
  const mail = await processOutbox(db, now);
  const bank = await syncAllAccounts(db);
  let cards: unknown = null;
  try {
    cards = await refreshActionCards(db);
  } catch (e) {
    console.error("[cron-cards]", e instanceof Error ? e.name : "unknown");
  }
  // カードを最新にしてから、毎日の要約を Slack に送る（設定がなければ何もしない・1日1回）
  const slack = await sendDailyDigest(db, { now });
  return { reminders, mail, bank, cards, slack };
}
