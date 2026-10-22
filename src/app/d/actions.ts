"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { lineConfigured } from "@/adapters/line";
import { validateFile } from "@/adapters/storage";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { AppError, invalid } from "@/lib/errors";
import { requireActorForAction, setSessionCookie } from "@/lib/session";
import { demoLoginAllowed } from "@/server/auth";
import { bindLineAccount, confirmEmail, loginWithLine, requestEmailVerification } from "@/server/drivers";
import { addReportFile, saveMyReport, submitMyReport } from "@/server/reports";
import { requestAvailabilityChange, saveMyAvailability, submitMyAvailability } from "@/server/shifts";
import { acknowledgeStatement, askAboutStatement } from "@/server/statements";

const MONTH = /^\d{4}-\d{2}$/;

/* ---------------- 稼働希望 ---------------- */

export async function saveAvailabilityAction(_: ActionResult, fd: FormData) {
  const month = str(fd, "month");
  return runAndRedirect(async () => {
    if (!MONTH.test(month)) throw invalid("対象月が正しくありません");
    const actor = await requireActorForAction();
    let days: { date: string; kind: "AVAILABLE" | "UNAVAILABLE" | "TIME" | ""; start?: string; end?: string }[];
    try {
      days = JSON.parse(str(fd, "days") || "[]");
    } catch {
      throw invalid("入力内容を読み取れませんでした");
    }
    if (!Array.isArray(days) || days.length > 31) throw invalid("入力内容が正しくありません");
    const db = getDb();
    await saveMyAvailability(db, actor, month, days);
    if (str(fd, "submit") === "1") {
      await submitMyAvailability(db, actor, month);
      return "avail_submitted";
    }
    return "avail_saved";
  }, () => `/d/availability?month=${month}`);
}

export async function requestChangeAction(_: ActionResult, fd: FormData) {
  const date = str(fd, "date");
  return runAndRedirect(async () => {
    await requestAvailabilityChange(getDb(), await requireActorForAction(), { date, kind: str(fd, "kind"), start: str(fd, "start"), end: str(fd, "end"), reason: str(fd, "reason") });
    return "change_requested";
  }, () => `/d/availability?month=${date.slice(0, 7)}`);
}

/* ---------------- 日報 ---------------- */

function reportFields(fd: FormData) {
  return { workDate: str(fd, "workDate"), projectId: str(fd, "projectId"), startTime: str(fd, "startTime"), endTime: str(fd, "endTime"), breakMinutes: str(fd, "breakMinutes"), quantity: str(fd, "quantity"), distanceKm: str(fd, "distanceKm"), notes: str(fd, "notes") };
}

export async function saveReportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = str(fd, "id") || null;
  const submit = str(fd, "submit") === "1";
  const r = await runAction(async () => {
    const actor = await requireActorForAction();
    const db = getDb();
    id = await saveMyReport(db, actor, id, reportFields(fd), false);
    const f = fd.get("file");
    if (f && typeof f !== "string" && f.size > 0) {
      if (f.size > 10 * 1024 * 1024) throw invalid("ファイルは10MB以下にしてください");
      const bytes = new Uint8Array(await f.arrayBuffer());
      validateFile(bytes);
      await addReportFile(db, actor, id, { name: f.name, bytes });
    }
    if (submit) await submitMyReport(db, actor, id);
  });
  if (r.ok) redirect(`/d/reports/${id}?flash=${submit ? "report_submitted" : "report_saved"}`);
  if (id && !str(fd, "id")) redirect(`/d/reports/${id}?flash=report_saved`); // 下書きは保存済み
  return r;
}

export async function submitReportAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    await submitMyReport(getDb(), await requireActorForAction(), id);
    return "report_submitted";
  }, () => `/d/reports/${id}`);
}

/* ---------------- 稼働明細 ---------------- */

export async function acknowledgeAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    await acknowledgeStatement(getDb(), await requireActorForAction(), id);
    return "acknowledged";
  }, () => `/d/statements/${id}`);
}

export async function inquiryAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    await askAboutStatement(getDb(), await requireActorForAction(), id, str(fd, "body"));
    return "asked";
  }, () => `/d/statements/${id}`);
}

/* ---------------- メール ---------------- */

export async function requestEmailAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await requestEmailVerification(getDb(), await requireActorForAction(), str(fd, "email"));
    return "email_sent";
  }, () => "/d/profile");
}

/** メール確認（リンクを開いた後、ボタンを押して確定。メールソフトの自動プレビューで確定しないように） */
export async function confirmEmailAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await confirmEmail(getDb(), str(fd, "token"));
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  redirect("/d/profile?flash=email_verified");
}

/* ---------------- 開発環境のみ: LINE の代わりの模擬連携 ---------------- */

export async function demoBindAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!demoLoginAllowed() || lineConfigured()) return { ok: false, message: "この環境では使えません", at: Date.now() };
  const db = getDb();
  const sub = `Udemo${randomBytes(14).toString("hex")}`;
  let dest = "/d/login?e=linked";
  try {
    const r = await bindLineAccount(db, str(fd, "token"), { sub, displayName: "デモLINE" });
    if (r.status === "ACTIVE") {
      const l = await loginWithLine(db, sub, { demo: true });
      if (l.result === "OK") {
        await setSessionCookie(l.token);
        dest = "/d";
      }
    }
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  redirect(dest);
}
