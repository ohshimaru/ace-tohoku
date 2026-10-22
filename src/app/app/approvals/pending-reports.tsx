import type { Actor } from "@/lib/access";

/** 日報の承認待ち（第2段階で日報機能と合わせて表示） */
export async function PendingReports({ actor }: { actor: Actor }) {
  void actor;
  return null;
}
