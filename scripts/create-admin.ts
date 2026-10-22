/**
 * 最初の経営者（会社管理者）アカウントを作成: pnpm admin:create
 * 環境変数で指定: ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD（12文字以上）
 * パスワードは画面・ログに表示しません。作成後はシェルの履歴から消してください。
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { appUser } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? "").trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("ADMIN_EMAIL を正しく指定してください");
  if (!name) throw new Error("ADMIN_NAME を指定してください");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD は12文字以上にしてください");
  const db = getDb();
  const [exists] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email)).limit(1);
  if (exists) throw new Error("このメールアドレスの利用者は既に存在します");
  await db.insert(appUser).values({ name, email, role: "OWNER", status: "ACTIVE", passwordHash: await hashPassword(password), emailVerifiedAt: new Date() });
  console.log(`経営者アカウントを作成しました: ${email}`);
  await closeDb();
}
main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
