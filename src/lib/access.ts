/**
 * 権限判定（純粋関数）。サーバー側の全処理はここを通す。
 * 権限表は docs/DESIGN.md「2. 利用者と権限」と一致させること。
 */
export type Role = "OWNER" | "ACCOUNTING" | "MANAGER" | "DRIVER" | "PROVIDER";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "経営者・会社管理者",
  ACCOUNTING: "経理",
  MANAGER: "事業部責任者",
  DRIVER: "業務委託ドライバー",
  PROVIDER: "サービス提供者",
};

export type Actor = {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  /** 責任者の担当事業部（OWNER/ACCOUNTING は全事業部なので空） */
  divisionIds: string[];
  /** 所属会社（本社・スタッフ）。サービス提供者は null（担当会社は都度DBで確認する） */
  companyId: string | null;
  demo: boolean;
};

/** 本社側（会社の管理画面を使う人）。サービス提供者・ドライバーは含まない */
export const isStaff = (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING" || a.role === "MANAGER";
export const isProvider = (a: Actor) => a.role === "PROVIDER";
export const isCompanyWide = (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING";

export const can = {
  /** 会社設定・事業部・ユーザー・予算ルール・監査ログ */
  administer: (a: Actor) => a.role === "OWNER",
  /** 本社として、サービス提供者が公開した入出金を見られる役割（実際に見える範囲は公開設定で決まる） */
  viewBank: (a: Actor) => a.role === "OWNER" || a.role === "ACCOUNTING",
  /** 銀行連携・取込・訂正・公開設定（サービス提供者のみ。担当会社かどうかは provider-finance で毎回確認） */
  manageBank: (a: Actor) => a.role === "PROVIDER",
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
  if (!isStaff(a)) return false;
  if (isCompanyWide(a)) return true;
  if (divisionId === null) return false; // 共通経費は全社権限のみ
  return a.divisionIds.includes(divisionId);
}

/** 事業部で絞り込むべき ID の一覧（null = 絞り込み不要） */
export function divisionScope(a: Actor): string[] | null {
  if (isCompanyWide(a)) return null;
  if (!isStaff(a)) return [];
  return a.divisionIds;
}
