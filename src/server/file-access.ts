/** 非公開ファイルの閲覧権限（参照元のデータを見られる人だけ） */
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { contract, dailyReport, expense, project } from "@/db/schema";
import { type Actor, canAccessDivision } from "@/lib/access";

export async function canReadOwner(db: DB, actor: Actor, ownerType: string, ownerId: string): Promise<boolean> {
  if (ownerType === "EXPENSE") {
    const [e] = await db.select({ applicantId: expense.applicantId, divisionId: expense.divisionId }).from(expense).where(eq(expense.id, ownerId)).limit(1);
    if (!e) return false;
    if (e.applicantId === actor.userId) return true;
    return actor.role !== "DRIVER" && canAccessDivision(actor, e.divisionId);
  }
  if (ownerType === "DAILY_REPORT") {
    const [r] = await db.select({ driverId: dailyReport.driverId, divisionId: project.divisionId }).from(dailyReport).innerJoin(project, eq(project.id, dailyReport.projectId)).where(eq(dailyReport.id, ownerId)).limit(1);
    if (!r) return false;
    if (r.driverId === actor.userId) return true;
    return actor.role !== "DRIVER" && canAccessDivision(actor, r.divisionId);
  }
  if (ownerType === "CONTRACT") {
    const [c] = await db.select({ divisionId: contract.divisionId, driverUserId: contract.driverUserId, status: contract.status }).from(contract).where(eq(contract.id, ownerId)).limit(1);
    if (!c) return false;
    if (actor.role === "DRIVER") return c.driverUserId === actor.userId && (c.status === "SIGNED" || c.status === "ENDED");
    return canAccessDivision(actor, c.divisionId);
  }
  return false;
}
