"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { inviteDriver, reissueInvite, setDriverStatus, updateDriverProfile } from "@/server/drivers";

export async function inviteDriverAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const r = await inviteDriver(getDb(), await requireActorForAction(), { name: str(fd, "name"), divisionId: str(fd, "divisionId"), email: str(fd, "email"), phone: str(fd, "phone"), partnerId: str(fd, "partnerId") });
    revalidatePath("/app/drivers");
    return { message: `招待を作成しました。次の招待リンクを本人に伝えてください（72時間有効・1回限り。この画面を離れると再表示できません）\n${r.inviteUrl}`, data: { url: r.inviteUrl } };
  });
}

export async function reissueInviteAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const url = await reissueInvite(getDb(), await requireActorForAction(), str(fd, "id"));
    return { message: `新しい招待リンクを作成しました（以前のリンクは無効）。\n${url}`, data: { url } };
  });
}

export async function driverStatusAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    const s = str(fd, "status") === "ACTIVE" ? "ACTIVE" : "SUSPENDED";
    await setDriverStatus(getDb(), await requireActorForAction(), id, s);
    return s === "ACTIVE" ? "approved" : "saved";
  }, () => `/app/drivers/${id}`);
}

export async function driverProfileAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAction(async () => {
    await updateDriverProfile(getDb(), await requireActorForAction(), id, {
      qualifications: str(fd, "qualifications"),
      vehicles: str(fd, "vehicles"),
      areas: str(fd, "areas"),
      maxDaysPerMonth: str(fd, "maxDaysPerMonth") as never,
      maxHoursPerDay: str(fd, "maxHoursPerDay") as never,
      taxMode: str(fd, "taxMode") as never,
      withholdingEnabled: str(fd, "withholdingEnabled") === "1",
      withholdingConfirmedNote: str(fd, "withholdingConfirmedNote"),
      partnerId: str(fd, "partnerId"),
      preferredProjectIds: fd.getAll("preferredProjectIds").filter((x): x is string => typeof x === "string" && x !== ""),
      note: str(fd, "note"),
    });
    revalidatePath(`/app/drivers/${id}`);
    return "保存しました";
  });
}
