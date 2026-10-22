import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { AppError } from "@/lib/errors";

export type ActionResult = { ok: boolean; message: string; at: number; data?: Record<string, string> };
export const initialResult: ActionResult = { ok: false, message: "", at: 0 };

/**
 * Server Action の共通処理: 業務エラーはそのまま表示し、想定外のエラーは内容を伏せる。
 * ログには個人情報・領収書内容を出さず、エラーの種類と識別子だけを残す。
 */
export async function runAction(fn: () => Promise<string | void | { message: string; data?: Record<string, string> }>): Promise<ActionResult> {
  try {
    const r = await fn();
    const message = typeof r === "string" ? r : r && typeof r === "object" ? r.message : "保存しました";
    const data = r && typeof r === "object" ? r.data : undefined;
    return { ok: true, message, at: Date.now(), data };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { ok: false, message: e.message, at: Date.now() };
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[action-error ${ref}]`, e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "unknown");
    return { ok: false, message: `処理に失敗しました。時間をおいて再度お試しください（エラー番号: ${ref}）`, at: Date.now() };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** FormData の文字列項目をオブジェクトに（ファイルは除外） */
export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) o[k] = v;
  return o;
}

/** 成功したら結果メッセージ付きで画面を再表示する（ボタンが消える操作向け） */
export async function runAndRedirect(fn: () => Promise<string | void>, to: () => string): Promise<ActionResult> {
  let code = "";
  const r = await runAction(async () => {
    code = (await fn()) || "";
  });
  if (r.ok) {
    const url = to();
    redirect(code ? `${url}${url.includes("?") ? "&" : "?"}flash=${code}` : url);
  }
  return r;
}
