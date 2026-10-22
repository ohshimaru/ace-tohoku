"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateFile } from "@/adapters/storage";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireActorForAction } from "@/lib/session";
import { addSignedFile, approveTemplate, createContract, createTemplateVersion, retireTemplate, setContractStatus, TERM_LABELS, updateContract } from "@/server/contracts";

function input(fd: FormData) {
  return {
    title: str(fd, "title"),
    ourSide: str(fd, "ourSide") as "ORDERER",
    partnerId: str(fd, "partnerId"),
    divisionId: str(fd, "divisionId"),
    projectId: str(fd, "projectId"),
    driverUserId: str(fd, "driverUserId"),
    templateId: str(fd, "templateId"),
    renewalNoticeDays: str(fd, "renewalNoticeDays"),
    terms: Object.fromEntries(Object.keys(TERM_LABELS).map((k) => [k, str(fd, `t_${k}`)])),
  };
}

export async function createContractAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    id = await createContract(getDb(), await requireActorForAction(), input(fd));
  });
  if (r.ok) redirect(`/app/contracts/${id}?flash=created`);
  return r;
}

export async function updateContractAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    await updateContract(getDb(), await requireActorForAction(), id, input(fd), str(fd, "reason"));
    return "saved";
  }, () => `/app/contracts/${id}`);
}

export async function contractStatusAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    const to = str(fd, "to");
    if (!["REVIEWED", "SENT", "SIGNED", "ENDED", "DRAFT"].includes(to)) throw invalid("不明な操作です");
    await setContractStatus(getDb(), await requireActorForAction(), id, to as "REVIEWED");
    return "saved";
  }, () => `/app/contracts/${id}`);
}

export async function signedFileAction(_: ActionResult, fd: FormData) {
  const id = str(fd, "id");
  return runAndRedirect(async () => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || f.size === 0) throw invalid("ファイルを選んでください");
    if (f.size > 10 * 1024 * 1024) throw invalid("ファイルは10MB以下にしてください");
    const bytes = new Uint8Array(await f.arrayBuffer());
    validateFile(bytes);
    await addSignedFile(getDb(), await requireActorForAction(), id, { name: f.name, bytes });
    return "saved";
  }, () => `/app/contracts/${id}`);
}

export async function createTemplateAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await createTemplateVersion(getDb(), await requireActorForAction(), { key: str(fd, "key"), name: str(fd, "name"), body: str(fd, "body"), note: str(fd, "note") });
    revalidatePath("/app/contracts/templates");
    return "新しい版を作成しました（未確認）。経営者が内容を確認して承認すると使えるようになります";
  });
}

export async function approveTemplateAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await approveTemplate(getDb(), await requireActorForAction(), str(fd, "id"), str(fd, "note"));
    return "approved";
  }, () => "/app/contracts/templates");
}

export async function retireTemplateAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await retireTemplate(getDb(), await requireActorForAction(), str(fd, "id"));
    return "saved";
  }, () => "/app/contracts/templates");
}
