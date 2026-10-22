/**
 * エースナンバー東北 経営管理システム スキーマ（Drizzle / PostgreSQL）
 * - 金額は円の整数（integer）。数量は numeric(12,2)。
 * - 業務日は JST の 'YYYY-MM-DD'（date）、月は 'YYYY-MM'（text）。時刻は timestamptz。
 * - 業務データは原則削除せず、状態（取消・無効）で管理する。
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const day = (n: string) => date(n, { mode: "string" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());
const qty = (n: string) => numeric(n, { precision: 12, scale: 2 });

/* ================================================================== */
/* 会社・事業部・利用者                                               */
/* ================================================================== */

export const companySetting = pgTable(
  "company_setting",
  {
    id: integer("id").primaryKey().default(1),
    companyName: text("company_name").notNull().default("株式会社エースナンバー東北"),
    appName: text("app_name").notNull().default("経営ナビ"),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(4),
    taxRounding: text("tax_rounding").notNull().default("FLOOR"), // FLOOR / ROUND / CEIL
    issuerAddress: text("issuer_address").notNull().default(""),
    registrationNumber: text("registration_number").notNull().default(""),
    /** 予算の予約額に「申請中の経費」を含めるか */
    reserveSubmittedExpenses: boolean("reserve_submitted_expenses").notNull().default(true),
    /** 予算の予約額に「発注済み費用」を含めるか */
    reserveCommitments: boolean("reserve_commitments").notNull().default(true),
    /** 資金余力の計算期間（日） */
    cashHorizonDays: integer("cash_horizon_days").notNull().default(30),
    /** 資金余力の警告しきい値（円） */
    cashWarningThreshold: integer("cash_warning_threshold").notNull().default(0),
    /** 外注費率の警告基準（%）。事業部ごとの上書きは division.outsourcing_ratio_limit */
    outsourcingRatioLimit: integer("outsourcing_ratio_limit").notNull().default(60),
    /** 稼働明細の支払日（翌月の日。末日は 31） */
    statementPayDay: integer("statement_pay_day").notNull().default(31),
    cleanupUrl: text("cleanup_url").notNull().default(""),
    demoDataLoadedAt: ts("demo_data_loaded_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("company_setting_singleton", sql`${t.id} = 1`),
    check("company_fy_month", sql`${t.fiscalYearStartMonth} between 1 and 12`),
  ],
);

export const divisionKindEnum = pgEnum("division_kind", ["GENERAL", "DRIVER", "CLEANING"]);

export const division = pgTable("division", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull().unique(),
  kind: divisionKindEnum("kind").notNull().default("GENERAL"),
  sortOrder: integer("sort_order").notNull().default(0),
  outsourcingRatioLimit: integer("outsourcing_ratio_limit"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const roleEnum = pgEnum("role", ["OWNER", "ACCOUNTING", "MANAGER", "DRIVER"]);
export const userStatusEnum = pgEnum("user_status", ["INVITED", "PENDING", "ACTIVE", "SUSPENDED"]);

export const appUser = pgTable(
  "app_user",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email"),
    emailVerifiedAt: ts("email_verified_at"),
    passwordHash: text("password_hash"),
    lineUserId: text("line_user_id").unique(),
    lineDisplayName: text("line_display_name"),
    role: roleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    approvedAt: ts("approved_at"),
    approvedById: uuid("approved_by_id").references((): AnyPgColumn => appUser.id),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("app_user_email_uq").on(sql`lower(${t.email})`)],
);

export const session = pgTable(
  "session",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => appUser.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    demo: boolean("demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const loginAttempt = pgTable(
  "login_attempt",
  { id: bigserial("id", { mode: "number" }).primaryKey(), key: text("key").notNull(), at: ts("at").notNull().defaultNow() },
  (t) => [index("login_attempt_key_idx").on(t.key, t.at)],
);

/** 1回限りのトークン（招待・メール確認・LINE認可の state） */
export const oneTimeToken = pgTable(
  "one_time_token",
  {
    id: id(),
    purpose: text("purpose").notNull(), // INVITE / EMAIL_VERIFY / LINE_STATE
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id").references(() => appUser.id),
    payload: jsonb("payload").$type<Record<string, string>>().notNull().default({}),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
);

export const userDivision = pgTable(
  "user_division",
  {
    userId: uuid("user_id").notNull().references(() => appUser.id),
    divisionId: uuid("division_id").notNull().references(() => division.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.divisionId] })],
);

export const expenseCategory = pgTable("expense_category", {
  id: id(),
  name: text("name").notNull().unique(),
  /** 外注費として扱う費目（外注費率の計算に使う） */
  isOutsourcing: boolean("is_outsourcing").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: ts("archived_at"),
});

/* ================================================================== */
/* 取引先（顧客・委託先）・案件                                         */
/* ================================================================== */

export const partnerTypeEnum = pgEnum("partner_type", ["CORPORATION", "INDIVIDUAL"]);

export const partner = pgTable(
  "partner",
  {
    id: id(),
    type: partnerTypeEnum("type").notNull().default("CORPORATION"),
    name: text("name").notNull(),
    nameKana: text("name_kana"),
    postalCode: text("postal_code"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    contactName: text("contact_name"),
    /** 顧客として扱う */
    isCustomer: boolean("is_customer").notNull().default(false),
    /** 業務委託先として扱う */
    isContractor: boolean("is_contractor").notNull().default(false),
    billingInfo: text("billing_info"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("partner_has_role", sql`${t.isCustomer} or ${t.isContractor}`), index("partner_name_idx").on(t.name)],
);

export const partnerDivision = pgTable(
  "partner_division",
  {
    partnerId: uuid("partner_id").notNull().references(() => partner.id),
    divisionId: uuid("division_id").notNull().references(() => division.id),
  },
  (t) => [primaryKey({ columns: [t.partnerId, t.divisionId] })],
);

export const partnerNote = pgTable("partner_note", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partner.id),
  divisionId: uuid("division_id").references(() => division.id),
  body: text("body").notNull(),
  authorId: uuid("author_id").references(() => appUser.id),
  createdAt: createdAt(),
});

export const projectStatusEnum = pgEnum("project_status", ["PROSPECT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELED"]);
export const contractTypeEnum = pgEnum("contract_type", ["MONTHLY", "ONE_OFF"]);

export type ReportFieldConfig = { quantity: boolean; quantityUnit: string; distance: boolean; breakTime: boolean; attachments: boolean };

export const project = pgTable(
  "project",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    divisionId: uuid("division_id").notNull().references(() => division.id),
    customerId: uuid("customer_id").references(() => partner.id),
    category: text("category").notNull().default(""), // SNS運用 / AI開発 / 配送 / 清掃 など（事業部ごとに自由）
    contractType: contractTypeEnum("contract_type").notNull().default("ONE_OFF"),
    amount: integer("amount").notNull().default(0), // 月額契約は月額、単発は契約金額（税抜）
    startDate: day("start_date"),
    endDate: day("end_date"),
    dueDate: day("due_date"),
    status: projectStatusEnum("status").notNull().default("ACTIVE"),
    reportFields: jsonb("report_fields")
      .$type<ReportFieldConfig>()
      .notNull()
      .default({ quantity: false, quantityUnit: "件", distance: false, breakTime: true, attachments: true }),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("project_external_uq").on(t.externalSource, t.externalId).where(sql`${t.externalId} is not null`),
    index("project_division_idx").on(t.divisionId),
  ],
);

/* ================================================================== */
/* 売上と入金（別管理）                                                */
/* ================================================================== */

export const billingStatusEnum = pgEnum("billing_status", ["UNBILLED", "BILLED", "NOT_REQUIRED"]);

export const sale = pgTable(
  "sale",
  {
    id: id(),
    recognizedOn: day("recognized_on").notNull(),
    month: text("month").notNull(), // 計上月 YYYY-MM
    divisionId: uuid("division_id").notNull().references(() => division.id),
    customerId: uuid("customer_id").references(() => partner.id),
    projectId: uuid("project_id").references(() => project.id),
    description: text("description").notNull(),
    amountExTax: integer("amount_ex_tax").notNull(),
    taxRate: integer("tax_rate").notNull().default(10),
    taxAmount: integer("tax_amount").notNull(),
    billingStatus: billingStatusEnum("billing_status").notNull().default("UNBILLED"),
    expectedReceiptDate: day("expected_receipt_date"),
    canceledAt: ts("canceled_at"),
    cancelReason: text("cancel_reason"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdById: uuid("created_by_id").references(() => appUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("sale_tax_rate", sql`${t.taxRate} in (0, 8, 10)`),
    check("sale_month", sql`${t.month} = to_char(${t.recognizedOn}, 'YYYY-MM')`),
    uniqueIndex("sale_external_uq").on(t.externalSource, t.externalId).where(sql`${t.externalId} is not null`),
    index("sale_month_idx").on(t.month, t.divisionId),
  ],
);

export const receipt = pgTable(
  "receipt",
  {
    id: id(),
    saleId: uuid("sale_id").notNull().references(() => sale.id),
    receivedOn: day("received_on").notNull(),
    amount: integer("amount").notNull(), // 税込
    note: text("note"),
    bankTransactionId: uuid("bank_transaction_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    canceledAt: ts("canceled_at"),
    cancelReason: text("cancel_reason"),
    createdById: uuid("created_by_id").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [check("receipt_positive", sql`${t.amount} > 0`), index("receipt_sale_idx").on(t.saleId)],
);

/* ================================================================== */
/* 経費と支払（別管理）                                                */
/* ================================================================== */

export const expenseStatusEnum = pgEnum("expense_status", ["DRAFT", "SUBMITTED", "APPROVED", "RETURNED", "REJECTED", "CANCELED"]);
export const settlementEnum = pgEnum("settlement_method", ["SEPARATE", "STATEMENT", "COMPANY_PAID"]);

export const expense = pgTable(
  "expense",
  {
    id: id(),
    usedOn: day("used_on").notNull(),
    month: text("month").notNull(),
    /** null = 共通経費（全社） */
    divisionId: uuid("division_id").references(() => division.id),
    projectId: uuid("project_id").references(() => project.id),
    categoryId: uuid("category_id").notNull().references(() => expenseCategory.id),
    applicantId: uuid("applicant_id").notNull().references(() => appUser.id),
    payee: text("payee").notNull(),
    purpose: text("purpose").notNull(),
    amount: integer("amount").notNull(), // 税込
    taxRate: integer("tax_rate").notNull().default(10),
    taxAmount: integer("tax_amount").notNull(),
    status: expenseStatusEnum("status").notNull().default("DRAFT"),
    /** SEPARATE=別払い / STATEMENT=稼働明細で精算 / COMPANY_PAID=会社が直接支払（立替なし） */
    settlement: settlementEnum("settlement").notNull().default("SEPARATE"),
    submittedAt: ts("submitted_at"),
    decidedById: uuid("decided_by_id").references(() => appUser.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    /** 予算超過の例外承認 */
    budgetExceptionById: uuid("budget_exception_by_id").references(() => appUser.id),
    budgetExceptionNote: text("budget_exception_note"),
    commitmentId: uuid("commitment_id"),
    /** 稼働明細に含めた場合の明細行 */
    statementLineId: uuid("statement_line_id"),
    canceledAt: ts("canceled_at"),
    cancelReason: text("cancel_reason"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("expense_amount_positive", sql`${t.amount} > 0`),
    check("expense_tax_rate", sql`${t.taxRate} in (0, 8, 10)`),
    check("expense_month", sql`${t.month} = to_char(${t.usedOn}, 'YYYY-MM')`),
    check("expense_no_self_decision", sql`${t.decidedById} is null or ${t.decidedById} <> ${t.applicantId} or ${t.status} in ('DRAFT','SUBMITTED','CANCELED')`),
    uniqueIndex("expense_statement_line_uq").on(t.statementLineId).where(sql`${t.statementLineId} is not null`),
    uniqueIndex("expense_external_uq").on(t.externalSource, t.externalId).where(sql`${t.externalId} is not null`),
    index("expense_month_idx").on(t.month, t.divisionId),
    index("expense_status_idx").on(t.status),
  ],
);

export const storedFile = pgTable("stored_file", {
  id: id(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  /** 参照元（権限判定に使う）: EXPENSE / DAILY_REPORT / CONTRACT */
  ownerType: text("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  uploadedById: uuid("uploaded_by_id").references(() => appUser.id),
  createdAt: createdAt(),
});

export const payableSourceEnum = pgEnum("payable_source", ["EXPENSE", "STATEMENT", "OTHER"]);
export const payableStatusEnum = pgEnum("payable_status", ["SCHEDULED", "PAID", "CANCELED"]);

/** 支払予定（経費の別払い・稼働明細・その他）。支払の実績は paid_* と銀行照合で管理 */
export const payable = pgTable(
  "payable",
  {
    id: id(),
    source: payableSourceEnum("source").notNull(),
    sourceId: uuid("source_id"),
    divisionId: uuid("division_id").references(() => division.id),
    payeeName: text("payee_name").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    dueDate: day("due_date").notNull(),
    status: payableStatusEnum("status").notNull().default("SCHEDULED"),
    paidOn: day("paid_on"),
    bankTransactionId: uuid("bank_transaction_id"),
    createdAt: createdAt(),
  },
  (t) => [
    // 同じ支払元から有効な支払予定は1件（二重払い防止）
    uniqueIndex("payable_source_uq").on(t.source, t.sourceId).where(sql`${t.sourceId} is not null and ${t.status} <> 'CANCELED'`),
  ],
);

/* ================================================================== */
/* 共通経費の配賦                                                       */
/* ================================================================== */

export const allocationMethodEnum = pgEnum("allocation_method", ["NONE", "FIXED_RATIO", "SALES_RATIO"]);

export const allocationRule = pgTable("allocation_rule", {
  id: id(),
  name: text("name").notNull(),
  method: allocationMethodEnum("method").notNull(),
  /** 対象の費目（null=すべての共通経費） */
  categoryId: uuid("category_id").references(() => expenseCategory.id),
  effectiveFrom: text("effective_from").notNull(), // YYYY-MM
  effectiveTo: text("effective_to"),
  priority: integer("priority").notNull().default(0),
  createdAt: createdAt(),
});

export const allocationShare = pgTable(
  "allocation_share",
  {
    ruleId: uuid("rule_id").notNull().references(() => allocationRule.id, { onDelete: "cascade" }),
    divisionId: uuid("division_id").notNull().references(() => division.id),
    /** 固定割合（万分率: 10000=100%） */
    ratioBp: integer("ratio_bp").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.divisionId] }), check("share_range", sql`${t.ratioBp} between 0 and 10000`)],
);

/* ================================================================== */
/* 予算                                                                 */
/* ================================================================== */

export const budgetPeriodEnum = pgEnum("budget_period", ["MONTH", "YEAR"]);
export const overActionEnum = pgEnum("over_action", ["WARN", "BLOCK"]);
export const budgetBaseEnum = pgEnum("budget_base", ["NONE", "SALES", "PROFIT"]);

export const budgetRule = pgTable("budget_rule", {
  id: id(),
  name: text("name").notNull(),
  divisionId: uuid("division_id").references(() => division.id),
  userId: uuid("user_id").references(() => appUser.id),
  categoryId: uuid("category_id").references(() => expenseCategory.id),
  period: budgetPeriodEnum("period").notNull().default("MONTH"),
  fixedAmount: integer("fixed_amount").notNull().default(0),
  perHeadAmount: integer("per_head_amount").notNull().default(0),
  /** 人数の数え方: DIVISION_DRIVERS（稼働中ドライバー）/ DIVISION_USERS（担当者） */
  headcountBasis: text("headcount_basis").notNull().default("DIVISION_DRIVERS"),
  base: budgetBaseEnum("base").notNull().default("NONE"),
  /** 売上・利益に対する割合（万分率） */
  baseRatioBp: integer("base_ratio_bp").notNull().default(0),
  /** 連動の基準期間: PREV（前期間の実績）/ SAME（同期間の実績） */
  baseWindow: text("base_window").notNull().default("PREV"),
  carryOver: boolean("carry_over").notNull().default(false),
  effectiveFrom: day("effective_from").notNull(),
  effectiveTo: day("effective_to"),
  overAction: overActionEnum("over_action").notNull().default("WARN"),
  priority: integer("priority").notNull().default(0),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const commitmentStatusEnum = pgEnum("commitment_status", ["OPEN", "CONSUMED", "CANCELED"]);

/** 発注済み費用（予約額に含める） */
export const budgetCommitment = pgTable("budget_commitment", {
  id: id(),
  divisionId: uuid("division_id").notNull().references(() => division.id),
  categoryId: uuid("category_id").notNull().references(() => expenseCategory.id),
  projectId: uuid("project_id").references(() => project.id),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  orderedOn: day("ordered_on").notNull(),
  month: text("month").notNull(),
  status: commitmentStatusEnum("status").notNull().default("OPEN"),
  createdById: uuid("created_by_id").references(() => appUser.id),
  createdAt: createdAt(),
});

export const requestStatusEnum = pgEnum("request_status", ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]);

export const budgetRequest = pgTable("budget_request", {
  id: id(),
  divisionId: uuid("division_id").notNull().references(() => division.id),
  categoryId: uuid("category_id").references(() => expenseCategory.id),
  month: text("month").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  requestedById: uuid("requested_by_id").notNull().references(() => appUser.id),
  decidedById: uuid("decided_by_id").references(() => appUser.id),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: createdAt(),
});

/** 承認済みの予算追加（追加申請の承認時に作成） */
export const budgetAdjustment = pgTable("budget_adjustment", {
  id: id(),
  divisionId: uuid("division_id").notNull().references(() => division.id),
  categoryId: uuid("category_id").references(() => expenseCategory.id),
  month: text("month").notNull(),
  amount: integer("amount").notNull(),
  requestId: uuid("request_id").unique().references(() => budgetRequest.id),
  reason: text("reason").notNull(),
  createdById: uuid("created_by_id").references(() => appUser.id),
  createdAt: createdAt(),
});

/* ================================================================== */
/* 月次締め・訂正                                                       */
/* ================================================================== */

export const monthClose = pgTable("month_close", {
  month: text("month").primaryKey(),
  closedAt: ts("closed_at").notNull(),
  closedById: uuid("closed_by_id").references(() => appUser.id),
  reopenedAt: ts("reopened_at"),
  reopenedById: uuid("reopened_by_id").references(() => appUser.id),
  reopenReason: text("reopen_reason"),
  isClosed: boolean("is_closed").notNull().default(true),
});

/* ================================================================== */
/* 銀行                                                                 */
/* ================================================================== */

export const bankAccount = pgTable("bank_account", {
  id: id(),
  bankName: text("bank_name").notNull(),
  branchName: text("branch_name").notNull(),
  accountType: text("account_type").notNull().default("普通"),
  /** 下4桁のみ（全桁は保存しない） */
  accountNumberLast4: text("account_number_last4").notNull(),
  holderName: text("holder_name").notNull().default(""),
  provider: text("provider").notNull().default("CSV"), // DEMO / CSV / API名
  providerAccountRef: text("provider_account_ref"),
  balance: integer("balance"),
  balanceAsOf: ts("balance_as_of"),
  lastSyncedAt: ts("last_synced_at"),
  syncStatus: text("sync_status").notNull().default("NEVER"), // NEVER / OK / FAILED
  lastError: text("last_error"),
  isDemo: boolean("is_demo").notNull().default(false),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const bankTxnClassEnum = pgEnum("bank_txn_class", [
  "UNCLASSIFIED",
  "SALES_RECEIPT",
  "EXPENSE_PAYMENT",
  "STATEMENT_PAYMENT",
  "TRANSFER",
  "LOAN",
  "TAX",
  "OTHER",
]);

export const bankTransaction = pgTable(
  "bank_transaction",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => bankAccount.id),
    txnDate: day("txn_date").notNull(),
    amount: integer("amount").notNull(), // 入金は正、出金は負
    description: text("description").notNull(),
    balanceAfter: integer("balance_after"),
    externalId: text("external_id").notNull(),
    classification: bankTxnClassEnum("classification").notNull().default("UNCLASSIFIED"),
    note: text("note"),
    importedAt: ts("imported_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bank_txn_external_uq").on(t.accountId, t.externalId), index("bank_txn_date_idx").on(t.txnDate)],
);

/** 取引と入金・支払予定の照合（1取引に複数可、1入金/支払は1取引まで） */
export const bankMatch = pgTable(
  "bank_match",
  {
    id: id(),
    transactionId: uuid("transaction_id").notNull().references(() => bankTransaction.id),
    targetType: text("target_type").notNull(), // RECEIPT / PAYABLE
    targetId: uuid("target_id").notNull(),
    amount: integer("amount").notNull(),
    matchedById: uuid("matched_by_id").references(() => appUser.id),
    matchedAt: ts("matched_at").notNull().defaultNow(),
    unmatchedAt: ts("unmatched_at"),
  },
  (t) => [uniqueIndex("bank_match_target_uq").on(t.targetType, t.targetId).where(sql`${t.unmatchedAt} is null`)],
);

export const bankSyncRun = pgTable("bank_sync_run", {
  id: id(),
  accountId: uuid("account_id").references(() => bankAccount.id),
  kind: text("kind").notNull(), // SYNC / CSV
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  status: text("status").notNull().default("RUNNING"), // RUNNING / OK / FAILED
  imported: integer("imported").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  error: text("error"),
});

/* ================================================================== */
/* 契約                                                                 */
/* ================================================================== */

export const templateStatusEnum = pgEnum("template_status", ["UNREVIEWED", "APPROVED", "RETIRED"]);

export const contractTemplate = pgTable(
  "contract_template",
  {
    id: id(),
    key: text("key").notNull(), // 同じ種類の版をまとめるキー
    version: integer("version").notNull(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    status: templateStatusEnum("status").notNull().default("UNREVIEWED"),
    approvedById: uuid("approved_by_id").references(() => appUser.id),
    approvedAt: ts("approved_at"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("template_key_version_uq").on(t.key, t.version)],
);

export const contractStatusEnum = pgEnum("contract_status", ["DRAFT", "REVIEWED", "SENT", "SIGNED", "ENDED"]);

export type ContractTerms = {
  ordererName: string;
  contractorName: string;
  scope: string;
  periodStart: string;
  periodEnd: string;
  fee: string;
  feeMethod: string;
  closingDay: string;
  paymentDay: string;
  expenseBurden: string;
  renewal: string;
  termination: string;
  confidentiality: string;
  deliverables: string;
  special: string;
};

export const contract = pgTable("contract", {
  id: id(),
  title: text("title").notNull(),
  /** 当社の立場: ORDERER（発注側）/ CONTRACTOR（受注側） */
  ourSide: text("our_side").notNull(),
  partnerId: uuid("partner_id").notNull().references(() => partner.id),
  divisionId: uuid("division_id").notNull().references(() => division.id),
  projectId: uuid("project_id").references(() => project.id),
  driverUserId: uuid("driver_user_id").references(() => appUser.id),
  templateId: uuid("template_id").notNull().references(() => contractTemplate.id),
  terms: jsonb("terms").$type<ContractTerms>().notNull(),
  renderedBody: text("rendered_body").notNull(),
  status: contractStatusEnum("status").notNull().default("DRAFT"),
  periodEnd: day("period_end"),
  renewalNoticeDays: integer("renewal_notice_days").notNull().default(30),
  revision: integer("revision").notNull().default(1),
  reviewedById: uuid("reviewed_by_id").references(() => appUser.id),
  reviewedAt: ts("reviewed_at"),
  sentAt: ts("sent_at"),
  signedAt: ts("signed_at"),
  signedFileId: uuid("signed_file_id"),
  endedAt: ts("ended_at"),
  createdById: uuid("created_by_id").references(() => appUser.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contractRevision = pgTable("contract_revision", {
  id: id(),
  contractId: uuid("contract_id").notNull().references(() => contract.id),
  revision: integer("revision").notNull(),
  terms: jsonb("terms").$type<ContractTerms>().notNull(),
  renderedBody: text("rendered_body").notNull(),
  templateId: uuid("template_id").notNull(),
  reason: text("reason").notNull(),
  createdById: uuid("created_by_id").references(() => appUser.id),
  createdAt: createdAt(),
});

/* ================================================================== */
/* ドライバー・稼働                                                     */
/* ================================================================== */

export const driver = pgTable("driver", {
  userId: uuid("user_id").primaryKey().references(() => appUser.id),
  partnerId: uuid("partner_id").references(() => partner.id),
  divisionId: uuid("division_id").notNull().references(() => division.id),
  phone: text("phone"),
  qualifications: text("qualifications").array().notNull().default(sql`ARRAY[]::text[]`),
  vehicles: text("vehicles").array().notNull().default(sql`ARRAY[]::text[]`),
  areas: text("areas").array().notNull().default(sql`ARRAY[]::text[]`),
  /** 月の稼働日数の上限（契約条件） */
  maxDaysPerMonth: integer("max_days_per_month"),
  /** 1日の稼働時間の上限（分） */
  maxMinutesPerDay: integer("max_minutes_per_day"),
  /** 源泉徴収を適用するか（確認済みの場合のみ true にする） */
  withholdingEnabled: boolean("withholding_enabled").notNull().default(false),
  withholdingConfirmedNote: text("withholding_confirmed_note"),
  /** 稼働明細の税区分: EXCLUSIVE（税抜金額＋消費税）/ INCLUSIVE（税込）/ EXEMPT（不課税） */
  taxMode: text("tax_mode").notNull().default("EXCLUSIVE"),
  preferredProjectIds: uuid("preferred_project_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  note: text("note"),
});

export const periodStatusEnum = pgEnum("period_status", ["OPEN", "CLOSED"]);

/** 稼働希望の受付期間（対象月・締切） */
export const availabilityPeriod = pgTable("availability_period", {
  month: text("month").primaryKey(),
  divisionId: uuid("division_id").references(() => division.id),
  deadline: ts("deadline").notNull(),
  status: periodStatusEnum("status").notNull().default("OPEN"),
  createdAt: createdAt(),
});

export const availabilityKindEnum = pgEnum("availability_kind", ["AVAILABLE", "UNAVAILABLE", "TIME"]);

export const availability = pgTable(
  "availability",
  {
    id: id(),
    driverId: uuid("driver_id").notNull().references(() => appUser.id),
    workDate: day("work_date").notNull(),
    month: text("month").notNull(),
    kind: availabilityKindEnum("kind").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("availability_driver_day_uq").on(t.driverId, t.workDate),
    check("availability_time", sql`${t.kind} <> 'TIME' or (${t.startTime} is not null and ${t.endTime} is not null and ${t.endTime} > ${t.startTime})`),
  ],
);

/** 稼働希望の提出状態（月×ドライバー） */
export const availabilitySubmission = pgTable(
  "availability_submission",
  {
    driverId: uuid("driver_id").notNull().references(() => appUser.id),
    month: text("month").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT / SUBMITTED
    submittedAt: ts("submitted_at"),
  },
  (t) => [primaryKey({ columns: [t.driverId, t.month] })],
);

export const availabilityChangeRequest = pgTable("availability_change_request", {
  id: id(),
  driverId: uuid("driver_id").notNull().references(() => appUser.id),
  workDate: day("work_date").notNull(),
  kind: availabilityKindEnum("kind").notNull(),
  startTime: time("start_time"),
  endTime: time("end_time"),
  reason: text("reason").notNull(),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  decidedById: uuid("decided_by_id").references(() => appUser.id),
  decidedAt: ts("decided_at"),
  createdAt: createdAt(),
});

export const slotStatusEnum = pgEnum("slot_status", ["OPEN", "CANCELED"]);

/** 稼働枠（案件・日付・時間帯・必要人数・条件） */
export const shiftSlot = pgTable(
  "shift_slot",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => project.id),
    workDate: day("work_date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    requiredCount: integer("required_count").notNull().default(1),
    requiredQualifications: text("required_qualifications").array().notNull().default(sql`ARRAY[]::text[]`),
    requiredVehicle: text("required_vehicle"),
    area: text("area"),
    note: text("note"),
    status: slotStatusEnum("status").notNull().default("OPEN"),
    createdAt: createdAt(),
  },
  (t) => [check("slot_time", sql`${t.endTime} > ${t.startTime}`), check("slot_count", sql`${t.requiredCount} between 1 and 100`), index("slot_date_idx").on(t.workDate)],
);

export const assignmentStatusEnum = pgEnum("assignment_status", ["DRAFT", "CONFIRMED", "CANCELED"]);

export const assignment = pgTable(
  "assignment",
  {
    id: id(),
    slotId: uuid("slot_id").notNull().references(() => shiftSlot.id),
    driverId: uuid("driver_id").notNull().references(() => appUser.id),
    workDate: day("work_date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    status: assignmentStatusEnum("status").notNull().default("DRAFT"),
    source: text("source").notNull().default("MANUAL"), // AUTO / MANUAL
    confirmedAt: ts("confirmed_at"),
    confirmedById: uuid("confirmed_by_id").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("assignment_slot_driver_uq").on(t.slotId, t.driverId).where(sql`${t.status} <> 'CANCELED'`),
    index("assignment_driver_day_idx").on(t.driverId, t.workDate),
  ],
);

export const assignmentHistory = pgTable("assignment_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  assignmentId: uuid("assignment_id").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  actorId: uuid("actor_id"),
  at: ts("at").notNull().defaultNow(),
});

/* ================================================================== */
/* 日報                                                                 */
/* ================================================================== */

export const reportStatusEnum = pgEnum("report_status", ["DRAFT", "SUBMITTED", "APPROVED", "RETURNED"]);

export const dailyReport = pgTable(
  "daily_report",
  {
    id: id(),
    driverId: uuid("driver_id").notNull().references(() => appUser.id),
    projectId: uuid("project_id").notNull().references(() => project.id),
    assignmentId: uuid("assignment_id").references(() => assignment.id),
    workDate: day("work_date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    quantity: qty("quantity"),
    distanceKm: qty("distance_km"),
    notes: text("notes").notNull().default(""),
    status: reportStatusEnum("status").notNull().default("DRAFT"),
    version: integer("version").notNull().default(1),
    submittedAt: ts("submitted_at"),
    decidedById: uuid("decided_by_id").references(() => appUser.id),
    decidedAt: ts("decided_at"),
    returnReason: text("return_reason"),
    /** この日報を含む稼働明細（確定済みの場合は訂正不可） */
    statementId: uuid("statement_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("daily_report_driver_project_day_uq").on(t.driverId, t.projectId, t.workDate),
    check("report_time", sql`${t.endTime} > ${t.startTime}`),
    check("report_break", sql`${t.breakMinutes} >= 0`),
  ],
);

export const dailyReportRevision = pgTable("daily_report_revision", {
  id: id(),
  reportId: uuid("report_id").notNull().references(() => dailyReport.id),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  reason: text("reason").notNull(),
  actorId: uuid("actor_id").references(() => appUser.id),
  createdAt: createdAt(),
});

/* ================================================================== */
/* 単価・稼働明細                                                       */
/* ================================================================== */

export const rateMethodEnum = pgEnum("rate_method", ["DAILY", "HOURLY", "PER_UNIT", "MONTHLY"]);

export const rate = pgTable(
  "rate",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => project.id),
    /** null = 案件の標準単価、指定あり = ドライバー個別単価（優先） */
    driverId: uuid("driver_id").references(() => appUser.id),
    method: rateMethodEnum("method").notNull(),
    unitPrice: integer("unit_price").notNull(),
    unitLabel: text("unit_label").notNull().default(""),
    effectiveFrom: day("effective_from").notNull(),
    effectiveTo: day("effective_to"),
    createdById: uuid("created_by_id").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [check("rate_positive", sql`${t.unitPrice} >= 0`), index("rate_lookup_idx").on(t.projectId, t.driverId, t.effectiveFrom)],
);

export const statementAdjustment = pgTable("statement_adjustment", {
  id: id(),
  driverId: uuid("driver_id").notNull().references(() => appUser.id),
  projectId: uuid("project_id").references(() => project.id),
  divisionId: uuid("division_id").notNull().references(() => division.id),
  month: text("month").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  approvedById: uuid("approved_by_id").references(() => appUser.id),
  approvedAt: ts("approved_at"),
  createdById: uuid("created_by_id").references(() => appUser.id),
  createdAt: createdAt(),
});

export const statementStatusEnum = pgEnum("statement_status", ["DRAFT", "REVIEW", "CONFIRMED", "PUBLISHED", "SUPERSEDED"]);

export const statement = pgTable(
  "statement",
  {
    id: id(),
    driverId: uuid("driver_id").notNull().references(() => appUser.id),
    month: text("month").notNull(),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => statement.id),
    correctionReason: text("correction_reason"),
    status: statementStatusEnum("status").notNull().default("DRAFT"),
    workAmount: integer("work_amount").notNull().default(0), // 稼働分（税抜）
    adjustmentAmount: integer("adjustment_amount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    withholdingAmount: integer("withholding_amount").notNull().default(0),
    expenseAmount: integer("expense_amount").notNull().default(0), // 立替経費（税込）
    payAmount: integer("pay_amount").notNull().default(0),
    payDueDate: day("pay_due_date"),
    /** 確定時の会社名・税設定・源泉設定などのスナップショット */
    snapshot: jsonb("snapshot"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    confirmedAt: ts("confirmed_at"),
    confirmedById: uuid("confirmed_by_id").references(() => appUser.id),
    publishedAt: ts("published_at"),
    acknowledgedAt: ts("acknowledged_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // 1ドライバー×1か月の有効な明細は1件
    uniqueIndex("statement_active_uq").on(t.driverId, t.month).where(sql`${t.status} <> 'SUPERSEDED'`),
  ],
);

export const statementLineKindEnum = pgEnum("statement_line_kind", ["WORK", "ADJUSTMENT", "EXPENSE"]);

export const statementLine = pgTable(
  "statement_line",
  {
    id: id(),
    statementId: uuid("statement_id").notNull().references(() => statement.id, { onDelete: "cascade" }),
    kind: statementLineKindEnum("kind").notNull(),
    divisionId: uuid("division_id").notNull().references(() => division.id),
    projectId: uuid("project_id").references(() => project.id),
    workDate: day("work_date"),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    unit: text("unit").notNull(),
    unitPrice: integer("unit_price").notNull(),
    amount: integer("amount").notNull(),
    rateId: uuid("rate_id"),
    reportId: uuid("report_id"),
    expenseId: uuid("expense_id"),
    adjustmentId: uuid("adjustment_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("statement_line_stmt_idx").on(t.statementId)],
);

export const statementInquiry = pgTable("statement_inquiry", {
  id: id(),
  statementId: uuid("statement_id").notNull().references(() => statement.id),
  driverId: uuid("driver_id").notNull().references(() => appUser.id),
  body: text("body").notNull(),
  reply: text("reply"),
  repliedById: uuid("replied_by_id").references(() => appUser.id),
  repliedAt: ts("replied_at"),
  createdAt: createdAt(),
});

/* ================================================================== */
/* メール送信（リマインド）                                             */
/* ================================================================== */

export const emailStatusEnum = pgEnum("email_status", ["QUEUED", "SENT", "FAILED", "SKIPPED"]);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    /** 同じキーのメールは1通だけ作る（重複送信防止） */
    dedupeKey: text("dedupe_key").notNull().unique(),
    kind: text("kind").notNull(),
    toUserId: uuid("to_user_id").references(() => appUser.id),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: emailStatusEnum("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: ts("sent_at"),
    driver: text("driver"),
    /** 送信時に「まだ必要か」を確認するための条件（例: 稼働希望の対象月） */
    context: jsonb("context").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("email_outbox_due_idx").on(t.status, t.nextAttemptAt)],
);

/** リマインドの送信タイミング（締切からの相対日数。負=締切前） */
export const reminderRule = pgTable("reminder_rule", {
  id: id(),
  kind: text("kind").notNull().default("AVAILABILITY"),
  offsetDays: integer("offset_days").notNull(),
  hour: integer("hour").notNull().default(9),
  enabled: boolean("enabled").notNull().default(true),
});

/* ================================================================== */
/* AIアクションカード                                                   */
/* ================================================================== */

export const actionStatusEnum = pgEnum("action_status", ["OPEN", "IN_PROGRESS", "DONE", "DISMISSED"]);

export type Evidence = { label: string; value: string }[];

export const actionCard = pgTable(
  "action_card",
  {
    id: id(),
    ruleKey: text("rule_key").notNull(),
    targetKey: text("target_key").notNull(),
    priority: integer("priority").notNull(), // 1=高 2=中 3=低
    divisionId: uuid("division_id").references(() => division.id),
    title: text("title").notNull(),
    finding: text("finding").notNull(),
    evidence: jsonb("evidence").$type<Evidence>().notNull(),
    periodLabel: text("period_label").notNull(),
    recommendation: text("recommendation").notNull(),
    needsTaxReview: boolean("needs_tax_review").notNull().default(false),
    assigneeRole: roleEnum("assignee_role").notNull(),
    assigneeId: uuid("assignee_id").references(() => appUser.id),
    dueDate: day("due_date"),
    link: text("link").notNull(),
    status: actionStatusEnum("status").notNull().default("OPEN"),
    /** 根拠が解消されたら自動で閉じる */
    resolvedAt: ts("resolved_at"),
    textSource: text("text_source").notNull().default("RULE"), // RULE / LLM
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    updatedById: uuid("updated_by_id").references(() => appUser.id),
  },
  (t) => [uniqueIndex("action_card_rule_target_uq").on(t.ruleKey, t.targetKey)],
);

/* ================================================================== */
/* 外部連携（Clean Up）・取込                                           */
/* ================================================================== */

export const importRun = pgTable("import_run", {
  id: id(),
  source: text("source").notNull(), // CLEANUP_INVOICES / CLEANUP_STATEMENTS / SALES_CSV / EXPENSE_CSV / BANK_CSV
  fileName: text("file_name").notNull(),
  status: text("status").notNull().default("RUNNING"),
  created: integer("created").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
  actorId: uuid("actor_id").references(() => appUser.id),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

/* ================================================================== */
/* 監査ログ                                                             */
/* ================================================================== */

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorId: uuid("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    divisionId: uuid("division_id"),
    summary: text("summary").notNull(),
    changes: jsonb("changes"),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_at_idx").on(t.at)],
);

/* ================================================================== */
/* ファイル本体（STORAGE_DRIVER=db のとき。Vercel など書き込めるディスクがない環境用） */
/* ================================================================== */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const storedBlob = pgTable("stored_blob", {
  key: text("key").primaryKey(),
  bytes: bytea("bytes").notNull(),
  createdAt: createdAt(),
});
