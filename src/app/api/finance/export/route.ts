import { getDb } from "@/db";
import { AppError } from "@/lib/errors";
import { getActor } from "@/lib/session";
import { exportVisibleCsv, viewerFor } from "@/server/finance-visibility";

export const dynamic = "force-dynamic";

/**
 * 入出金CSV（本社・スタッフ・サービス提供者）。毎回ログインと公開範囲・出力権限を確認して作成する。
 * 保存済みのファイルやダウンロード用URLは作らない（公開停止後はこのURLからの取得も拒否される）
 */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const p = (k: string) => u.searchParams.get(k) ?? undefined;
  try {
    const db = getDb();
    const viewer = await viewerFor(db, actor, actor.role === "PROVIDER" ? p("company") : undefined);
    const csv = await exportVisibleCsv(db, actor, viewer, { from: p("from"), to: p("to"), accountId: p("account"), q: p("q") });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("入出金.csv")}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.code === "FORBIDDEN" ? "Forbidden" : "Not Found", { status: e.code === "FORBIDDEN" ? 403 : 404 });
    console.error("[finance-export-error]", e instanceof Error ? e.name : "unknown");
    return new Response("Error", { status: 500 });
  }
}
