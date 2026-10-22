import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { runScheduledJobs } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron などから呼ぶ（Authorization: Bearer CRON_SECRET） */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await runScheduledJobs(getDb());
  return NextResponse.json({ ok: true, reminders: r.reminders, mail: r.mail, slack: r.slack.status });
}
