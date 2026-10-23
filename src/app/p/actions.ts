"use server";

/** サービス提供者の操作（すべて requireProviderForAction ＋ 担当会社の確認をサーバー側で行う） */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { type ActionResult, runAction, runAndRedirect, str } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { requireProviderForAction } from "@/lib/session";
import { archiveBankAccount, createBankAccount, importBankCsv, matchPayable, matchReceipt, receiveFromTxn, syncBankAccount, unmatch } from "@/server/bank";
import {
  addCorrection,
  addManualTxn,
  previewVisibility,
  type ProviderFilter,
  savePolicy,
  type Selection,
  setExcluded,
  setVisibility,
  updateTxnMeta,
  type VisibilityChange,
} from "@/server/provider-finance";

const cid = (fd: FormData) => str(fd, "companyId");
const txnBack = (fd: FormData) => `/p/${cid(fd)}/t/${str(fd, "txnId")}`;

/* ---------- 表示先の変更 ---------- */

function changeFrom(fd: FormData): VisibilityChange {
  const c: VisibilityChange = {};
  const st = str(fd, "status");
  if (st) c.status = st as VisibilityChange["status"];
  const hq = str(fd, "hq");
  if (hq) c.hq = hq === "1";
  const staff = str(fd, "staff");
  if (staff) c.staff = staff === "1";
  if (str(fd, "setAudience") === "1") c.audience = { users: fd.getAll("audUser").map(String).filter(Boolean), divisions: fd.getAll("audDivision").map(String).filter(Boolean) };
  return c;
}

function selectionFrom(fd: FormData): Selection {
  if (str(fd, "mode") === "filter") {
    const raw = str(fd, "filter");
    let f: ProviderFilter = {};
    try {
      f = JSON.parse(raw || "{}");
    } catch {
      throw invalid("絞り込み条件が正しくありません");
    }
    return { filter: { from: f.from, to: f.to, accountId: f.accountId, q: f.q, classification: f.classification, projectId: f.projectId, status: f.status, hq: f.hq, staff: f.staff, excluded: f.excluded } };
  }
  return { ids: fd.getAll("id").map(String).filter(Boolean) };
}

/** 一括変更の確認（対象件数・変更後に見える件数）。実行はしない */
export async function previewBulkAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const r = await previewVisibility(getDb(), await requireProviderForAction(), cid(fd), selectionFrom(fd), changeFrom(fd));
    return { message: "確認してください", data: { count: String(r.count), afterHq: String(r.afterHq), afterStaff: String(r.afterStaff), staffNoAudience: String(r.staffNoAudience), ids: r.ids.join(",") } };
  });
}

/** 確認した対象（ID）と件数で実行。件数が変わっていたら実行しない */
export async function applyVisibilityAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ids = str(fd, "ids").split(",").filter(Boolean);
    const expected = Number(str(fd, "expectedCount"));
    const r = await setVisibility(getDb(), await requireProviderForAction(), cid(fd), { ids }, changeFrom(fd), Number.isFinite(expected) ? expected : undefined);
    revalidatePath(`/p/${cid(fd)}`);
    return `${r.count}件の表示先を変更しました`;
  });
}

/** 1件の表示先（詳細画面） */
export async function setTxnVisibilityAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await setVisibility(getDb(), await requireProviderForAction(), cid(fd), { ids: [str(fd, "txnId")] }, { ...changeFrom(fd), audience: { users: fd.getAll("audUser").map(String).filter(Boolean), divisions: fd.getAll("audDivision").map(String).filter(Boolean) } });
    return "saved";
  }, () => txnBack(fd));
}

/* ---------- 分類・メモ・確認状態 ---------- */

export async function updateMetaAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await updateTxnMeta(getDb(), await requireProviderForAction(), str(fd, "txnId"), { classification: str(fd, "classification") as never, note: str(fd, "note"), confirmStatus: str(fd, "confirmStatus") as never, projectId: str(fd, "projectId") });
    return "saved";
  }, () => txnBack(fd));
}

/* ---------- 手動取引・訂正 ---------- */

export async function addCorrectionAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await addCorrection(getDb(), await requireProviderForAction(), str(fd, "txnId"), { txnDate: str(fd, "txnDate"), direction: str(fd, "direction") as never, amount: str(fd, "amount"), description: str(fd, "description"), reason: str(fd, "reason") });
    return "saved";
  }, () => txnBack(fd));
}

export async function addManualAction(_: ActionResult, fd: FormData) {
  let id = "";
  return runAndRedirect(async () => {
    id = await addManualTxn(getDb(), await requireProviderForAction(), str(fd, "accountId"), { txnDate: str(fd, "txnDate"), direction: str(fd, "direction") as never, amount: str(fd, "amount"), description: str(fd, "description"), reason: str(fd, "reason") });
    return "saved";
  }, () => `/p/${cid(fd)}/t/${id}`);
}

/* ---------- 集計対象外 ---------- */

export async function setExcludedAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await setExcluded(getDb(), await requireProviderForAction(), str(fd, "txnId"), str(fd, "excluded") === "1", str(fd, "reason"));
    return "saved";
  }, () => txnBack(fd));
}

/* ---------- 公開権限 ---------- */

export async function savePolicyAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const b = (k: string) => fd.get(k) === "on";
    await savePolicy(getDb(), await requireProviderForAction(), cid(fd), str(fd, "subject"), { viewDetails: b("viewDetails"), viewRealBalance: b("viewRealBalance"), viewAllTotals: b("viewAllTotals"), viewPublishedTotals: b("viewPublishedTotals"), canExport: b("canExport") });
    revalidatePath(`/p/${cid(fd)}/disclosure`);
    return "公開権限を保存しました";
  });
}

/* ---------- 口座・取込 ---------- */

export async function createAccountAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    await createBankAccount(getDb(), await requireProviderForAction(), cid(fd), { bankName: str(fd, "bankName"), branchName: str(fd, "branchName"), accountType: str(fd, "accountType") as never, accountNumberLast4: str(fd, "last4"), holderName: str(fd, "holderName"), provider: str(fd, "provider") as never, openingBalance: str(fd, "openingBalance") });
    revalidatePath(`/p/${cid(fd)}/accounts`);
    return "口座を登録しました";
  });
}
export async function archiveAccountAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await archiveBankAccount(getDb(), await requireProviderForAction(), str(fd, "id"));
    return "saved";
  }, () => `/p/${cid(fd)}/accounts`);
}
export async function syncAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const r = await syncBankAccount(getDb(), await requireProviderForAction(), str(fd, "id"));
    revalidatePath(`/p/${cid(fd)}`, "layout");
    return `同期しました（新規 ${r.imported}件・既存 ${r.skipped}件。新しい取引は下書きです）`;
  });
}
export async function importCsvAction(_: ActionResult, fd: FormData) {
  return runAction(async () => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || f.size === 0) throw invalid("CSVファイルを選んでください");
    if (f.size > 5 * 1024 * 1024) throw invalid("CSVは5MB以下にしてください");
    const r = await importBankCsv(getDb(), await requireProviderForAction(), str(fd, "id"), f.name, await f.text());
    revalidatePath(`/p/${cid(fd)}`, "layout");
    return `取り込みました（新規 ${r.imported}件・取込済み ${r.skipped}件。新しい取引は下書きです）`;
  });
}

/* ---------- 照合（自社の売上・支払予定） ---------- */

export async function matchReceiptAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await matchReceipt(getDb(), await requireProviderForAction(), str(fd, "txnId"), str(fd, "receiptId"));
    return "matched";
  }, () => txnBack(fd));
}
export async function receiveAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    const amt = str(fd, "amount").replace(/,/g, "");
    await receiveFromTxn(getDb(), await requireProviderForAction(), str(fd, "txnId"), str(fd, "saleId"), amt ? Number(amt) : undefined);
    return "matched";
  }, () => txnBack(fd));
}
export async function matchPayableAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await matchPayable(getDb(), await requireProviderForAction(), str(fd, "txnId"), str(fd, "payableId"));
    return "matched";
  }, () => txnBack(fd));
}
export async function unmatchAction(_: ActionResult, fd: FormData) {
  return runAndRedirect(async () => {
    await unmatch(getDb(), await requireProviderForAction(), str(fd, "matchId"), str(fd, "reason"));
    return "unmatched";
  }, () => txnBack(fd));
}
