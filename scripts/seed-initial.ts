/**
 * 初期データ（何度実行しても重複しない）: pnpm db:seed
 * - 事業部 3つ（SNS・AI開発 / 業務委託 / 清掃）
 * - 費目
 * - 契約テンプレートのひな形（未確認。承認するまで使えない）
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { contractTemplate, division, expenseCategory } from "@/db/schema";

async function main() {
  const db = getDb();
  const divs = await db
    .insert(division)
    .values([
      { code: "SNS", name: "SNS・AI開発事業部", kind: "GENERAL", sortOrder: 10 },
      { code: "DRV", name: "業務委託事業部", kind: "DRIVER", sortOrder: 20 },
      { code: "CLN", name: "清掃事業部", kind: "CLEANING", sortOrder: 30 },
    ])
    .onConflictDoNothing()
    .returning({ id: division.id });
  const cats = await db
    .insert(expenseCategory)
    .values([
      { name: "外注費", isOutsourcing: true, sortOrder: 10 },
      { name: "燃料費", sortOrder: 20 },
      { name: "駐車場・高速代", sortOrder: 30 },
      { name: "旅費交通費", sortOrder: 40 },
      { name: "消耗品費", sortOrder: 50 },
      { name: "通信費", sortOrder: 60 },
      { name: "広告宣伝費", sortOrder: 70 },
      { name: "ソフトウェア・クラウド利用料", sortOrder: 80 },
      { name: "地代家賃", sortOrder: 90 },
      { name: "車両費", sortOrder: 100 },
      { name: "会議費", sortOrder: 110 },
      { name: "支払手数料", sortOrder: 120 },
      { name: "雑費", sortOrder: 900 },
    ])
    .onConflictDoNothing()
    .returning({ id: expenseCategory.id });
  const body = readFileSync(path.join(process.cwd(), "scripts/data/template-outsourcing.txt"), "utf8");
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from contract_template where key = 'outsourcing'`)).rows;
  if (n === 0) await db.insert(contractTemplate).values({ key: "outsourcing", version: 1, name: "業務委託契約書（ひな形）", body, status: "UNREVIEWED", note: "初期ひな形。使用前に専門家の確認が必要です" });
  console.log(`初期データ: 事業部 ${divs.length}件・費目 ${cats.length}件を追加${n === 0 ? "・契約テンプレート（未確認）を追加" : ""}（既存分はそのまま）`);
  await closeDb();
}
main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
