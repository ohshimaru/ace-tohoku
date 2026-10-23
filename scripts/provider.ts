/**
 * サービス提供者の管理（運営側のコマンド。本社・スタッフの画面からは操作できない）
 *
 *   作成:     PROVIDER_EMAIL=… PROVIDER_NAME=… PROVIDER_PASSWORD='…' pnpm provider create
 *   担当追加: PROVIDER_EMAIL=… COMPANY_ID=…（省略時は自社） pnpm provider assign
 *   担当解除: PROVIDER_EMAIL=… COMPANY_ID=… pnpm provider unassign
 *   会社追加: COMPANY_NAME=… pnpm provider add-company
 *   一覧:     pnpm provider list
 * パスワードは画面・ログに表示しません。作成後はシェルの履歴から消してください。
 * 担当の追加・解除は次の操作からすぐに反映されます（担当解除で、その会社のデータには即アクセスできなくなる）。
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { appUser, company, providerAssignment, SELF_COMPANY_ID } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";

async function provider(email: string) {
  const [u] = await getDb().select().from(appUser).where(and(eq(appUser.email, email.trim().toLowerCase()), eq(appUser.role, "PROVIDER"))).limit(1);
  if (!u) throw new Error("このメールアドレスのサービス提供者はいません");
  return u;
}

async function main() {
  const db = getDb();
  const cmd = process.argv[2];
  const email = (process.env.PROVIDER_EMAIL ?? "").trim().toLowerCase();
  const companyId = process.env.COMPANY_ID || SELF_COMPANY_ID;
  if (cmd === "create") {
    const name = (process.env.PROVIDER_NAME ?? "").trim();
    const password = process.env.PROVIDER_PASSWORD ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("PROVIDER_EMAIL を正しく指定してください");
    if (!name) throw new Error("PROVIDER_NAME を指定してください");
    if (password.length < 12) throw new Error("PROVIDER_PASSWORD は12文字以上にしてください");
    const [exists] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email)).limit(1);
    if (exists) throw new Error("このメールアドレスの利用者は既に存在します");
    await db.insert(appUser).values({ name, email, role: "PROVIDER", companyId: null, status: "ACTIVE", passwordHash: await hashPassword(password), emailVerifiedAt: new Date() });
    console.log(`サービス提供者を作成しました: ${email}（担当会社は assign で追加してください）`);
  } else if (cmd === "assign" || cmd === "unassign") {
    const u = await provider(email);
    const [c] = await db.select().from(company).where(eq(company.id, companyId)).limit(1);
    if (!c) throw new Error("会社が見つかりません");
    if (cmd === "assign") await db.insert(providerAssignment).values({ userId: u.id, companyId }).onConflictDoNothing();
    else await db.delete(providerAssignment).where(and(eq(providerAssignment.userId, u.id), eq(providerAssignment.companyId, companyId)));
    console.log(`${u.name} の担当を${cmd === "assign" ? "追加" : "解除"}しました: ${c.name}`);
  } else if (cmd === "add-company") {
    const name = (process.env.COMPANY_NAME ?? "").trim();
    if (!name) throw new Error("COMPANY_NAME を指定してください");
    const [c] = await db.insert(company).values({ name }).returning();
    console.log(`会社を追加しました: ${c.name}（ID: ${c.id}）`);
  } else if (cmd === "list") {
    const r = await db.execute<{ email: string; name: string; companies: string | null }>(sql`
      select u.email, u.name, string_agg(c.name, '、') companies from app_user u left join provider_assignment pa on pa.user_id = u.id left join company c on c.id = pa.company_id
      where u.role = 'PROVIDER' group by u.id order by u.name`);
    for (const x of r.rows) console.log(`${x.name} <${x.email}>: ${x.companies ?? "（担当なし）"}`);
  } else {
    throw new Error("使い方: pnpm provider create | assign | unassign | add-company | list");
  }
  await closeDb();
}
main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
