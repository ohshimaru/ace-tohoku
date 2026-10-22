import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** トランザクション内外どちらでも使える型 */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

const globalForDb = globalThis as unknown as { __bohPool?: Pool; __bohDb?: DB };

function createDb(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません（.env を確認してください）");
  const pool = globalForDb.__bohPool ?? new Pool({ connectionString: url, max: 10 });
  globalForDb.__bohPool = pool;
  return drizzle(pool, { schema });
}

/** 遅延初期化（ビルド時にDB接続しないため） */
export function getDb(): DB {
  if (!globalForDb.__bohDb) globalForDb.__bohDb = createDb();
  return globalForDb.__bohDb;
}

export async function closeDb() {
  await globalForDb.__bohPool?.end();
  globalForDb.__bohPool = undefined;
  globalForDb.__bohDb = undefined;
}

export { schema };
