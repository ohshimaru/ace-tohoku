import "server-only";
import type { DB } from "@/db";
import { refreshActionCards } from "./actions-engine";
import { processOutbox, scheduleAvailabilityReminders } from "./mailer";

/** 定期処理: リマインドの予約 → メール送信（再試行含む） → AI行動カードの更新。何度実行しても重複しない */
export async function runScheduledJobs(db: DB, now = new Date()) {
  const reminders = await scheduleAvailabilityReminders(db, now);
  const mail = await processOutbox(db, now);
  let cards: unknown = null;
  try {
    cards = await refreshActionCards(db);
  } catch (e) {
    console.error("[cron-cards]", e instanceof Error ? e.name : "unknown");
  }
  return { reminders, mail, cards };
}
