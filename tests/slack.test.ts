import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/db";
import { actionCard, slackPost, slackRequest } from "@/db/schema";
import { bucketOf, buildDigest, digestToSlack, sendDailyDigest } from "@/server/digest";
import { callbackToken, completeRequest, recordRequest, routineText, slackUserAllowed, verifyCallbackToken, verifySlackSignature } from "@/server/slack-requests";
import { makeDivision, makeUser, resetDb } from "./helpers/db";

beforeAll(async () => {
  await resetDb();
  const d = await makeDivision("SNS", "SNS・AI開発事業部");
  await makeUser("代表", "OWNER");
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(actionCard).values([
    { ruleKey: "r1", targetKey: "a", priority: 1, divisionId: d, title: "期限切れの指摘", finding: "f", evidence: [], periodLabel: "p", recommendation: "r", assigneeRole: "ACCOUNTING", dueDate: "2020-01-01", link: "/app" },
    { ruleKey: "r2", targetKey: "b", priority: 2, divisionId: null, title: "今日の指摘", finding: "f", evidence: [], periodLabel: "p", recommendation: "r", assigneeRole: "OWNER", dueDate: today, link: "/app" },
  ]);
});
afterAll(closeDb);

describe("タスクの整理と毎日の要約", () => {
  it("期限で分類", () => {
    expect(bucketOf("2026-10-01", "2026-10-23")).toBe("OVERDUE");
    expect(bucketOf("2026-10-23", "2026-10-23")).toBe("TODAY");
    expect(bucketOf("2026-10-29", "2026-10-23")).toBe("WEEK");
    expect(bucketOf("2026-10-30", "2026-10-23")).toBe("LATER");
    expect(bucketOf(null, "2026-10-23")).toBe("LATER");
  });

  it("要約に新しい指摘と今日のタスクが入る", async () => {
    const d = await buildDigest(getDb());
    expect(d.created).toHaveLength(2);
    expect(d.tasks.map((t) => t.bucket).sort()).toEqual(expect.arrayContaining(["OVERDUE"]));
    const msg = JSON.stringify(digestToSlack(d, true));
    expect(msg).toContain("期限切れの指摘");
    expect(msg).toContain("AI社員の動き");
  });

  it("Slack 未設定なら送らず、設定済みなら1日1回だけ送る（失敗は再試行）", async () => {
    const db = getDb();
    delete process.env.SLACK_WEBHOOK_URL;
    expect((await sendDailyDigest(db)).status).toBe("NOT_CONFIGURED");
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("err", { status: 500 })).mockResolvedValue(new Response("ok"));
    const now = new Date("2026-10-23T00:00:00Z");
    expect((await sendDailyDigest(db, { now })).status).toBe("FAILED");
    expect((await sendDailyDigest(db, { now })).status).toBe("SENT");
    expect((await sendDailyDigest(db, { now })).status).toBe("ALREADY_SENT");
    expect(f).toHaveBeenCalledTimes(2);
    const rows = await db.select().from(slackPost);
    expect(rows.filter((r) => r.dedupeKey === "digest:2026-10-23")).toHaveLength(1);
    f.mockRestore();
    delete process.env.SLACK_WEBHOOK_URL;
  });
});

describe("Slack → Claude → Slack", () => {
  it("Slack の署名を検証（改ざん・古いリクエストは拒否）", () => {
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
    const body = "text=hello&user_id=U1";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v0=${createHmac("sha256", "test-signing-secret").update(`v0:${ts}:${body}`).digest("hex")}`;
    expect(verifySlackSignature(body, ts, sig)).toBe(true);
    expect(verifySlackSignature(body + "x", ts, sig)).toBe(false);
    expect(verifySlackSignature(body, String(Number(ts) - 600), sig)).toBe(false);
    expect(verifySlackSignature(body, ts, null)).toBe(false);
  });

  it("許可された利用者だけ（設定がなければ全員）", () => {
    delete process.env.SLACK_ALLOWED_USER_IDS;
    expect(slackUserAllowed("U9")).toBe(true);
    process.env.SLACK_ALLOWED_USER_IDS = "U1, U2";
    expect(slackUserAllowed("U1")).toBe(true);
    expect(slackUserAllowed("U9")).toBe(false);
    delete process.env.SLACK_ALLOWED_USER_IDS;
  });

  it("結果は依頼ごとの署名が必要で、1回だけ投稿される", async () => {
    const db = getDb();
    const row = await recordRequest(db, { userId: "U1", userName: "taro", channelId: "C1", text: "売上の要約を作って", responseUrl: null });
    expect(routineText(row)).toContain(callbackToken(row.id));
    expect(verifyCallbackToken(row.id, callbackToken(row.id))).toBe(true);
    const other = await recordRequest(db, { userId: "U1", userName: "taro", channelId: "C1", text: "別", responseUrl: null });
    expect(verifyCallbackToken(row.id, callbackToken(other.id))).toBe(false);
    expect(await completeRequest(db, { id: row.id, status: "done", result: "要約です" })).toBe(true);
    expect(await completeRequest(db, { id: row.id, status: "done", result: "二回目" })).toBe(false);
    const [r] = await db.select().from(slackRequest).where(eq(slackRequest.id, row.id));
    expect(r.status).toBe("DONE");
    expect(r.result).toBe("要約です");
  });
});
