/**
 * 環境変数の解決（Vercel のデータベース連携が自動で設定する名前にも対応）
 * - Neon（Vercel Storage）: DATABASE_URL / DATABASE_URL_UNPOOLED
 * - Supabase（Vercel Marketplace）: POSTGRES_URL / POSTGRES_URL_NON_POOLING
 */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

export function migrateDatabaseUrl(): string | undefined {
  return process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || databaseUrl();
}

/** 公開URL（招待リンク・メール・LINEのコールバック）。未設定なら Vercel の本番URL */
export function appUrl(): string {
  const v = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || "http://localhost:3000";
  return v.replace(/\/$/, "");
}

/** ログイン試行制限に使う接続元IPのヘッダー（Vercel では x-forwarded-for を自動で使う） */
export function trustedIpHeader(): string | undefined {
  return process.env.TRUSTED_IP_HEADER || (process.env.VERCEL ? "x-forwarded-for" : undefined);
}
