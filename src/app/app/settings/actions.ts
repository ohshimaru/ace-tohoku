"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { createStaff, endAllocationRule, saveAllocationRule, saveCategory, saveDivision, setDivisionArchived, updateSettings, updateStaff } from "@/server/masters";

const done = () => revalidatePath("/app/settings");

export async function updateSettingsAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const g = (k: string) => str(fd, k);
    await updateSettings(getDb(), await requireActorForAction(), {
      companyName: g("companyName"), appName: g("appName"), fiscalYearStartMonth: g("fiscalYearStartMonth"), taxRounding: g("taxRounding") as "FLOOR",
      issuerAddress: g("issuerAddress"), registrationNumber: g("registrationNumber"), reserveSubmittedExpenses: g("reserveSubmittedExpenses") === "1", reserveCommitments: g("reserveCommitments") === "1",
      cashHorizonDays: g("cashHorizonDays"), cashWarningThreshold: g("cashWarningThreshold"), outsourcingRatioLimit: g("outsourcingRatioLimit"), statementPayDay: g("statementPayDay"), cleanupUrl: g("cleanupUrl"),
    });
    revalidatePath("/", "layout");
    return "会社設定を保存しました";
  });
}

export async function saveDivisionAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await saveDivision(getDb(), await requireActorForAction(), str(fd, "id") || null, { code: str(fd, "code"), name: str(fd, "name"), kind: str(fd, "kind") as "GENERAL", sortOrder: str(fd, "sortOrder"), outsourcingRatioLimit: str(fd, "outsourcingRatioLimit") });
    done();
    return "事業部を保存しました";
  });
}

export async function archiveDivisionAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await setDivisionArchived(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "archived") === "1");
    done();
    return "更新しました";
  });
}

export async function saveCategoryAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await saveCategory(getDb(), await requireActorForAction(), { name: str(fd, "name"), isOutsourcing: str(fd, "isOutsourcing") === "1", sortOrder: Number(str(fd, "sortOrder")) });
    done();
    return "費目を追加しました";
  });
}

export async function createStaffAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await createStaff(getDb(), await requireActorForAction(), { name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role") as "OWNER", divisionIds: fd.getAll("divisionIds").map(String), password: str(fd, "password") });
    done();
    return "利用者を追加しました。初期パスワードを安全な方法で本人に伝えてください";
  });
}

export async function updateStaffAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await updateStaff(getDb(), await requireActorForAction(), str(fd, "id"), { role: str(fd, "role"), status: str(fd, "status"), divisionIds: fd.getAll("divisionIds").map(String) });
    done();
    return "利用者を更新しました";
  });
}

export async function saveAllocationAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const shares: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("share_") && typeof v === "string") shares[k.slice(6)] = v;
    await saveAllocationRule(getDb(), await requireActorForAction(), { name: str(fd, "name"), method: str(fd, "method"), categoryId: str(fd, "categoryId"), effectiveFrom: str(fd, "effectiveFrom"), effectiveTo: str(fd, "effectiveTo"), priority: str(fd, "priority"), shares });
    done();
    return "配賦ルールを追加しました";
  });
}

export async function endAllocationAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await endAllocationRule(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "month"));
    done();
    return "配賦ルールの終了月を設定しました";
  });
}
