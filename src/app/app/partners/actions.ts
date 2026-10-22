"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { type ActionResult, runAction, str } from "@/lib/action";
import { requireActorForAction } from "@/lib/session";
import { addPartnerNote, savePartner, saveProject, setPartnerArchived } from "@/server/partners";

function partnerForm(fd: FormData) {
  return {
    type: str(fd, "type") as "CORPORATION",
    name: str(fd, "name"),
    nameKana: str(fd, "nameKana"),
    postalCode: str(fd, "postalCode"),
    address: str(fd, "address"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    contactName: str(fd, "contactName"),
    billingInfo: str(fd, "billingInfo"),
    isCustomer: str(fd, "isCustomer") === "1",
    isContractor: str(fd, "isContractor") === "1",
    divisionIds: fd.getAll("divisionIds").map(String),
  };
}

export async function savePartnerAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const existing = str(fd, "id");
  let id = "";
  const r = await runAction(async () => {
    id = await savePartner(getDb(), await requireActorForAction(), existing || null, partnerForm(fd));
    revalidatePath(`/app/partners/${id}`);
    return "保存しました";
  });
  if (r.ok && !existing) redirect(`/app/partners/${id}?flash=created`);
  return r;
}

export async function addNoteAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await addPartnerNote(getDb(), await requireActorForAction(), str(fd, "id"), { body: str(fd, "body"), divisionId: str(fd, "divisionId") });
    revalidatePath(`/app/partners/${str(fd, "id")}`);
    return "対応メモを追加しました";
  });
}

export async function archivePartnerAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await setPartnerArchived(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "archived") === "1");
    revalidatePath(`/app/partners/${str(fd, "id")}`);
    return "更新しました";
  });
}

function projectForm(fd: FormData) {
  const g = (k: string) => str(fd, k);
  return {
    code: g("code"), name: g("name"), divisionId: g("divisionId"), customerId: g("customerId"), category: g("category"), contractType: g("contractType") as "MONTHLY",
    amount: g("amount") || "0", startDate: g("startDate"), endDate: g("endDate"), dueDate: g("dueDate"), status: (g("status") || "ACTIVE") as "ACTIVE",
    rfQuantity: g("rfQuantity") === "1", rfQuantityUnit: g("rfQuantityUnit") || "件", rfDistance: g("rfDistance") === "1", rfBreakTime: g("rfBreakTime") === "1", rfAttachments: g("rfAttachments") === "1",
  };
}

export async function saveProjectAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const existing = str(fd, "id");
  let id = "";
  const r = await runAction(async () => {
    id = await saveProject(getDb(), await requireActorForAction(), existing || null, projectForm(fd));
    revalidatePath(`/app/projects/${id}`);
    return "保存しました";
  });
  if (r.ok && !existing) redirect(`/app/projects/${id}?flash=created`);
  return r;
}
