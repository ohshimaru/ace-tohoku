/** マイグレーション適用: pnpm db:migrate */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { migrateDatabaseUrl } from "../src/lib/env";

async function main() {
  const url = migrateDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL が未設定です");
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("マイグレーションを適用しました");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
