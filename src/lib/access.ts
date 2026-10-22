/**
 * 権限判定（純粋関数）。サーバー側の全処理はここを通す。
 * 権限表は docs/DESIGN.md「2. 利用者と権限」と一致させること。
 */
export type Role = "OWNER" | "ACCOUNTING" | "MANAGER" | "DRIVER";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "経営者・会社管理者",
  ACCOUNTING: "経理",
  MANAGER: "事業部責任者",
  DRIVER: "業務委託ドライバー",
};

export type Actor = {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  /** 責任者の担当事業部（OWNER/ACCOUNTING は全事業部なので空） */
  divisionIds: string[];
  demo: boolean;
};

export const isStaff = (a: Actor) => a.role !== "DRIVER";
export const isCompanyWide = (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING";

export const can = {
  /** 会社設定・事業部・ユーザー・予算ルール・監査ログ */
  administer: (a: Actor) => a.role === "OWNER",
  /** 銀行口座・残高・取引（全社の資金） */
  viewBank: (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING",
  manageBank: (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING",
  /** 月次締め */
  closeMonth: (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING",
  /** 入金・支払・稼働明細の確定 */
  manageAccounting: (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING",
  /** 予算ルールの編集 */
  editBudgetRules: (a: Actor) => a.role === "OWNER",
  /** 契約の作成・編集 */
  manageContracts: (a: Actor) => a.role === "OWNER" || a.role === "MANAGER",
  /** 契約テンプレートの承認 */
  approveTemplates: (a: Actor) => a.role === "OWNER",
  /** ドライバーの招待・承認・停止 */
  manageDrivers: (a: Actor) => a.role === "OWNER" || a.role === "MANAGER",
};

/** 事業部を閲覧・操作できるか（null = 全社・共通） */
export function canAccessDivision(a: Actor, divisionId: string | null): boolean {
  if (a.role === "DRIVER") return false;
  if (isCompanyWide(a)) return true;
  if (divisionId === null) return false; // 共通経費は全社権限のみ
  return a.divisionIds.includes(divisionId);
}

/** 事業部で絞り込むべき ID の一覧（null = 絞り込み不要） */
export function divisionScope(a: Actor): string[] | null {
  if (isCompanyWide(a)) return null;
  return a.divisionIds;
}
