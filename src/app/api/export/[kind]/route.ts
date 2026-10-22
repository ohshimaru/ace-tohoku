import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { getActor } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { scheduleWorkbook, type ScheduleScope, statementWorkbook } from "@/server/exports";
import { statementPdf } from "@/server/statement-pdf";

export const dynamic = "force-dynamic";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const UUID = /^[0-9a-f-]{36}$/;

function file(buf: Buffer, name: string, type: string) {
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

/** /api/export/schedule?month=YYYY-MM&scope=all|division|project|driver&id=… ／ /api/export/statement?id=…&format=pdf|xlsx */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const { kind } = await params;
  const sp = req.nextUrl.searchParams;
  try {
    const db = getDb();
    if (kind === "schedule") {
      const month = sp.get("month") ?? "";
      if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "対象月が正しくありません" }, { status: 400 });
      const k = sp.get("scope") ?? "all";
      const id = sp.get("id") ?? "";
      let scope: ScheduleScope = { kind: "all" };
      if (actor.role === "DRIVER") scope = { kind: "driver", id: actor.userId }; // 本人分のみ（サービス側でも強制）
      else if (k === "division" || k === "project" || k === "driver") {
        if (!UUID.test(id)) return NextResponse.json({ error: "対象が正しくありません" }, { status: 400 });
        scope = { kind: k, id };
      }
      const { buffer } = await scheduleWorkbook(db, actor, month, scope);
      return file(buffer, `schedule_${month}_${scope.kind}.xlsx`, XLSX);
    }
    if (kind === "statement") {
      const id = sp.get("id") ?? "";
      if (!UUID.test(id)) return NextResponse.json({ error: "対象が正しくありません" }, { status: 400 });
      if (sp.get("format") === "pdf") {
        const r = await statementPdf(db, actor, id);
        return file(r.buffer, r.name, "application/pdf");
      }
      const r = await statementWorkbook(db, actor, id);
      return file(r.buffer, r.name, XLSX);
    }
    return NextResponse.json({ error: "不明な出力です" }, { status: 404 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[export-error]", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "出力に失敗しました" }, { status: 500 });
  }
}
