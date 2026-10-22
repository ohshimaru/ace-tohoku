export type AppErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT";

/** 利用者に表示してよいメッセージを持つ業務エラー */
export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "この操作を行う権限がありません") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "対象のデータが見つかりません") => new AppError("NOT_FOUND", msg);
export const invalid = (msg: string) => new AppError("VALIDATION", msg);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);

/** PostgreSQL の一意制約違反か */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = findPgError(e);
  if (!err || err.code !== "23505") return false;
  return constraint ? err.constraint === constraint : true;
}

export function isCheckViolation(e: unknown, constraint?: string): boolean {
  const err = findPgError(e);
  if (!err || err.code !== "23514") return false;
  return constraint ? err.constraint === constraint : true;
}

function findPgError(e: unknown): { code?: string; constraint?: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur === "object" && cur !== null && "code" in cur && typeof (cur as { code: unknown }).code === "string") {
      return cur as { code?: string; constraint?: string };
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
