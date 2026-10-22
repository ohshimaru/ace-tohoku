import "server-only";
import type { DB } from "@/db";
import type { Actor } from "@/lib/access";
import { approvedTemplates } from "@/server/contracts";
import { listDrivers } from "@/server/drivers";
import { listDivisions } from "@/server/masters";
import { partnerOptions, projectOptions } from "@/server/partners";

export async function contractOptions(db: DB, actor: Actor) {
  const [partners, divisions, projects, drivers, templates] = await Promise.all([partnerOptions(db, actor), listDivisions(db, actor), projectOptions(db, actor), listDrivers(db, actor).catch(() => []), approvedTemplates(db)]);
  return { partners, divisions: divisions.map((d) => ({ id: d.id, name: d.name })), projects, drivers: drivers.map(({ u }) => ({ id: u.id, name: u.name })), templates };
}
