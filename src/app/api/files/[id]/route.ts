import { getDb } from "@/db";
import { AppError } from "@/lib/errors";
import { getActor } from "@/lib/session";
import { readStoredFile } from "@/server/expenses";

export const dynamic = "force-dynamic";

/** 非公開ファイルの配信。取得のたびにログインと参照元の閲覧権限を確認する */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not Found", { status: 404 });
  try {
    const f = await readStoredFile(getDb(), actor, id);
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": f.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not Found", { status: 404 });
    console.error("[file-error]", e instanceof Error ? e.name : "unknown");
    return new Response("Error", { status: 500 });
  }
}
