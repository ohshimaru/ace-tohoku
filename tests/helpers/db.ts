import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { appUser, division, driver, expenseCategory, userDivision } from "@/db/schema";
import type { Actor, Role } from "@/lib/access";

export async function resetDb() {
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "./drizzle" });
}

let n = 0;
export async function makeUser(name: string, role: Role, opts: { divisionIds?: string[]; driverDivisionId?: string } = {}): Promise<Actor> {
  const db = getDb();
  const [u] = await db.insert(appUser).values({ name, email: `u${++n}-${Date.now()}@example.test`, role, status: "ACTIVE" }).returning();
  if (role === "MANAGER") for (const d of opts.divisionIds ?? []) await db.insert(userDivision).values({ userId: u.id, divisionId: d });
  if (role === "DRIVER") await db.insert(driver).values({ userId: u.id, divisionId: opts.driverDivisionId! });
  return { userId: u.id, name, email: u.email, role, divisionIds: role === "MANAGER" ? (opts.divisionIds ?? []) : [], demo: false };
}

export async function makeDivision(code: string, name: string, kind: "GENERAL" | "DRIVER" | "CLEANING" = "GENERAL") {
  const [d] = await getDb().insert(division).values({ code, name, kind }).returning();
  return d.id;
}

export async function makeCategory(name: string, isOutsourcing = false) {
  const [c] = await getDb().insert(expenseCategory).values({ name, isOutsourcing }).returning();
  return c.id;
}
