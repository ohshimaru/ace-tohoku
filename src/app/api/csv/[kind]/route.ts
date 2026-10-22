import { getDb } from "@/db";
import { MONTH_RE } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { getActor } from "@/lib/session";
import { exportExpensesCsv, exportSalesCsv, SALES_IMPORT_HEADER, toCsv } from "@/server/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { kind } = await ctx.params;
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "";
  const to = u.searchParams.get("to") ?? from;
  try {
    let body: string;
    let name: string;
    if (kind === "sales-template") {
      body = toCsv(SALES_IMPORT_HEADER, [["2026-10-31", "SNS", "SNS-001", "10月分 運用費", "300000", "10", "2026-11-30", "例: 請求書番号など（任意）"]]);
      name = "売上取込テンプレート.csv";
    } else {
      if (!MONTH_RE.test(from) || !MONTH_RE.test(to)) return new Response("期間を指定してください", { status: 400 });
      if (kind === "sales") {
        body = await exportSalesCsv(getDb(), actor, from, to);
        name = `売上_${from}_${to}.csv`;
      } else if (kind === "expenses") {
        body = await exportExpensesCsv(getDb(), actor, from, to);
        name = `経費_${from}_${to}.csv`;
      } else return new Response("Not Found", { status: 404 });
    }
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
