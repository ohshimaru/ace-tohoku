import type { Role } from "./access";

export type GuideStep = { title: string; body: string; href: string; cta: string };

/** 立場ごとの「まずはここから」 */
export function guideSteps(role: Role, opts: { hasDriverDivision: boolean }): GuideStep[] {
  const s: Record<string, GuideStep> = {
    actions: { title: "AIの対応指示を見る", body: "未入金・予算超過・日報の未提出など、今やるべきことが根拠の数字つきで並びます。担当と期限を決めて「対応中」「完了」にします。", href: "/app/actions", cta: "対応することを開く" },
    pl: { title: "事業部ごとの儲けを見る", body: "売上・経費・外注費・共通経費の配賦後の利益を事業部別に表示します。数字を押すと明細まで確認できます。", href: "/app/pl", cta: "損益・予実を開く" },
    approvals: { title: "申請を承認する", body: "経費の申請と日報がここに集まります。内容を確認して承認・差戻しします。", href: "/app/approvals", cta: "承認を開く" },
    bank: { title: "銀行の入出金を照合する", body: "口座の入出金を、売上の入金や支払予定と結び付けます。照合すると支払予定が「支払済み」になります。", href: "/app/bank", cta: "銀行口座を開く" },
    statements: { title: "ドライバーの稼働明細を確定する", body: "承認済みの日報から月の明細を作り、確定・公開します。確定すると支払予定が作られます。", href: "/app/statements", cta: "稼働明細を開く" },
    months: { title: "月を締める", body: "確認が終わった月を締めると、その月の売上・経費は変更できなくなります。", href: "/app/months", cta: "月次締めを開く" },
    shifts: { title: "来月の稼働を組む", body: "ドライバーの稼働希望を集め、枠を作って自動割当（下書き）→ 調整 → 確定します。", href: "/app/shifts", cta: "稼働スケジュールを開く" },
    expense: { title: "経費を申請する", body: "領収書の写真を添えて申請します。予算の残りもその場で確認できます。", href: "/app/expenses/new", cta: "経費を申請" },
  };
  if (role === "OWNER") return [s.actions, s.pl, s.approvals, s.bank];
  if (role === "ACCOUNTING") return [s.actions, s.bank, s.statements, s.months];
  return opts.hasDriverDivision ? [s.actions, s.approvals, s.shifts, s.pl] : [s.actions, s.approvals, s.expense, s.pl];
}
