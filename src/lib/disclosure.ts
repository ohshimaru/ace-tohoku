/**
 * 入出金の公開権限（純粋な定義）。判定と取得は server/finance-visibility.ts で行う。
 */
export type Policy = {
  /** 明細（公開された取引）の閲覧 */
  viewDetails: boolean;
  /** 実際の銀行残高の閲覧 */
  viewRealBalance: boolean;
  /** 全取引（非公開を含む）の集計の閲覧 */
  viewAllTotals: boolean;
  /** 公開された取引だけの集計の閲覧 */
  viewPublishedTotals: boolean;
  /** CSV 出力 */
  canExport: boolean;
};

export const POLICY_KEYS: (keyof Policy)[] = ["viewDetails", "viewPublishedTotals", "viewAllTotals", "viewRealBalance", "canExport"];

export const POLICY_LABELS: Record<keyof Policy, { label: string; hint: string; risky?: boolean }> = {
  viewDetails: { label: "明細の閲覧", hint: "公開した取引の日付・金額・内容を表示します（公開していない取引は表示されません）" },
  viewPublishedTotals: { label: "公開された取引だけの集計", hint: "「公開対象の入出金合計」として表示します。実際の残高や会社全体の収支ではありません" },
  viewAllTotals: { label: "全取引の集計", hint: "非公開の取引も含めた入出金の合計・件数・月別推移を表示します", risky: true },
  viewRealBalance: { label: "実際の銀行残高", hint: "銀行から取得した口座残高を表示します", risky: true },
  canExport: { label: "CSV出力", hint: "閲覧できる明細だけを CSV で出力できます（明細の閲覧が必要）" },
};

/** 行がないときの初期値。本社・スタッフとも、公開された取引だけを対象にする */
export const DEFAULT_POLICY: Record<"HQ" | "STAFF", Policy> = {
  HQ: { viewDetails: true, viewRealBalance: false, viewAllTotals: false, viewPublishedTotals: true, canExport: false },
  // スタッフは初期状態で何も見えない。提供者がスタッフごとに「明細の閲覧」を許可した人だけ（事業部あての公開も同じ）
  STAFF: { viewDetails: false, viewRealBalance: false, viewAllTotals: false, viewPublishedTotals: false, canExport: false },
};

export const PROVIDER_POLICY: Policy = { viewDetails: true, viewRealBalance: true, viewAllTotals: true, viewPublishedTotals: true, canExport: true };

export const PUBLISH_LABEL: Record<string, string> = { DRAFT: "下書き", PUBLISHED: "公開中", SUSPENDED: "公開停止" };
export const CONFIRM_LABEL: Record<string, string> = { UNCONFIRMED: "未確認", CONFIRMED: "確認済み", NEEDS_REVIEW: "要確認" };
