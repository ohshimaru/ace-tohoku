/** 月次締め。締めた月の売上・経費・入金は変更できず、訂正は締めを解除（理由必須・記録あり）してから行う */
import { desc, eq } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { monthClose } from "@/db/schema";
import { type Actor, can } from "@/lib/access";
import { MONTH_RE } from "@/lib/dates";
import { conflict, forbidden, invalid } from "@/lib/errors";
import { writeAudit } from "./audit";
import { parse, zText } from "./validate";

export async function isMonthClosed(db: Tx, month: string) {
  const [m] = await db.select().from(monthClose).where(eq(monthClose.month, month)).limit(1);
  return !!m?.isClosed;
}

/** 締め済みの月なら変更を拒否する（行ロックで締め処理と競合しないようにする） */
export async function assertMonthOpen(tx: Tx, month: string, what = "データ") {
  const [m] = await tx.select().from(monthClose).where(eq(monthClose.month, month)).for("share");
  if (m?.isClosed) throw conflict(`${month} は月次締め済みのため、${what}を変更できません。訂正が必要な場合は経理が締めを解除してください`);
}

export async function listMonthCloses(db: DB) {
  return db.select().from(monthClose).orderBy(desc(monthClose.month));
}

export async function closeMonth(db: DB, actor: Actor, month: string) {
  if (!can.closeMonth(actor)) throw forbidden("月次締めは経営者・経理のみ可能です");
  if (!MONTH_RE.test(month)) throw invalid("月の形式が正しくありません");
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(monthClose).where(eq(monthClose.month, month)).for("update");
    if (m?.isClosed) throw conflict(`${month} は既に締め済みです`);
    if (m) await tx.update(monthClose).set({ isClosed: true, closedAt: new Date(), closedById: actor.userId }).where(eq(monthClose.month, month));
    else await tx.insert(monthClose).values({ month, closedAt: new Date(), closedById: actor.userId });
    await writeAudit(tx, actor, { action: "month.close", entityType: "month_close", entityId: month, summary: `${month} を月次締め` });
  });
}

export async function reopenMonth(db: DB, actor: Actor, month: string, reason: string) {
  if (!can.closeMonth(actor)) throw forbidden("締めの解除は経営者・経理のみ可能です");
  const why = parse(zText("解除理由", 500), reason);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(monthClose).where(eq(monthClose.month, month)).for("update");
    if (!m?.isClosed) throw conflict(`${month} は締められていません`);
    await tx.update(monthClose).set({ isClosed: false, reopenedAt: new Date(), reopenedById: actor.userId, reopenReason: why }).where(eq(monthClose.month, month));
    await writeAudit(tx, actor, { action: "month.reopen", entityType: "month_close", entityId: month, summary: `${month} の締めを解除: ${why}` });
  });
}
