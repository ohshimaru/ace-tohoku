CREATE TYPE "public"."action_status" AS ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."allocation_method" AS ENUM('NONE', 'FIXED_RATIO', 'SALES_RATIO');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('DRAFT', 'CONFIRMED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."availability_kind" AS ENUM('AVAILABLE', 'UNAVAILABLE', 'TIME');--> statement-breakpoint
CREATE TYPE "public"."bank_txn_class" AS ENUM('UNCLASSIFIED', 'SALES_RECEIPT', 'EXPENSE_PAYMENT', 'STATEMENT_PAYMENT', 'TRANSFER', 'LOAN', 'TAX', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('UNBILLED', 'BILLED', 'NOT_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."budget_base" AS ENUM('NONE', 'SALES', 'PROFIT');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('MONTH', 'YEAR');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('OPEN', 'CONSUMED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('DRAFT', 'REVIEWED', 'SENT', 'SIGNED', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('MONTHLY', 'ONE_OFF');--> statement-breakpoint
CREATE TYPE "public"."division_kind" AS ENUM('GENERAL', 'DRIVER', 'CLEANING');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."over_action" AS ENUM('WARN', 'BLOCK');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('CORPORATION', 'INDIVIDUAL');--> statement-breakpoint
CREATE TYPE "public"."payable_source" AS ENUM('EXPENSE', 'STATEMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payable_status" AS ENUM('SCHEDULED', 'PAID', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('PROSPECT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."rate_method" AS ENUM('DAILY', 'HOURLY', 'PER_UNIT', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('OWNER', 'ACCOUNTING', 'MANAGER', 'DRIVER');--> statement-breakpoint
CREATE TYPE "public"."settlement_method" AS ENUM('SEPARATE', 'STATEMENT', 'COMPANY_PAID');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('OPEN', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."statement_line_kind" AS ENUM('WORK', 'ADJUSTMENT', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('DRAFT', 'REVIEW', 'CONFIRMED', 'PUBLISHED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('UNREVIEWED', 'APPROVED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('INVITED', 'PENDING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "action_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"target_key" text NOT NULL,
	"priority" integer NOT NULL,
	"division_id" uuid,
	"title" text NOT NULL,
	"finding" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"period_label" text NOT NULL,
	"recommendation" text NOT NULL,
	"needs_tax_review" boolean DEFAULT false NOT NULL,
	"assignee_role" "role" NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"link" text NOT NULL,
	"status" "action_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_at" timestamp with time zone,
	"text_source" text DEFAULT 'RULE' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "allocation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"method" "allocation_method" NOT NULL,
	"category_id" uuid,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_share" (
	"rule_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"ratio_bp" integer NOT NULL,
	CONSTRAINT "allocation_share_rule_id_division_id_pk" PRIMARY KEY("rule_id","division_id"),
	CONSTRAINT "share_range" CHECK ("allocation_share"."ratio_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"line_user_id" text,
	"line_display_name" text,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_line_user_id_unique" UNIQUE("line_user_id")
);
--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"status" "assignment_status" DEFAULT 'DRAFT' NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"division_id" uuid,
	"summary" text NOT NULL,
	"changes" jsonb
);
--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"month" text NOT NULL,
	"kind" "availability_kind" NOT NULL,
	"start_time" time,
	"end_time" time,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_time" CHECK ("availability"."kind" <> 'TIME' or ("availability"."start_time" is not null and "availability"."end_time" is not null and "availability"."end_time" > "availability"."start_time"))
);
--> statement-breakpoint
CREATE TABLE "availability_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" "availability_kind" NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_period" (
	"month" text PRIMARY KEY NOT NULL,
	"division_id" uuid,
	"deadline" timestamp with time zone NOT NULL,
	"status" "period_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_submission" (
	"driver_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "availability_submission_driver_id_month_pk" PRIMARY KEY("driver_id","month")
);
--> statement-breakpoint
CREATE TABLE "bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" text NOT NULL,
	"branch_name" text NOT NULL,
	"account_type" text DEFAULT '普通' NOT NULL,
	"account_number_last4" text NOT NULL,
	"holder_name" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT 'CSV' NOT NULL,
	"provider_account_ref" text,
	"balance" integer,
	"balance_as_of" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'NEVER' NOT NULL,
	"last_error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"matched_by_id" uuid,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unmatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bank_sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"balance_after" integer,
	"external_id" text NOT NULL,
	"classification" "bank_txn_class" DEFAULT 'UNCLASSIFIED' NOT NULL,
	"note" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid NOT NULL,
	"category_id" uuid,
	"month" text NOT NULL,
	"amount" integer NOT NULL,
	"request_id" uuid,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_adjustment_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "budget_commitment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"project_id" uuid,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"ordered_on" date NOT NULL,
	"month" text NOT NULL,
	"status" "commitment_status" DEFAULT 'OPEN' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid NOT NULL,
	"category_id" uuid,
	"month" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"division_id" uuid,
	"user_id" uuid,
	"category_id" uuid,
	"period" "budget_period" DEFAULT 'MONTH' NOT NULL,
	"fixed_amount" integer DEFAULT 0 NOT NULL,
	"per_head_amount" integer DEFAULT 0 NOT NULL,
	"headcount_basis" text DEFAULT 'DIVISION_DRIVERS' NOT NULL,
	"base" "budget_base" DEFAULT 'NONE' NOT NULL,
	"base_ratio_bp" integer DEFAULT 0 NOT NULL,
	"base_window" text DEFAULT 'PREV' NOT NULL,
	"carry_over" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"over_action" "over_action" DEFAULT 'WARN' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_setting" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text DEFAULT '株式会社エースナンバー東北' NOT NULL,
	"app_name" text DEFAULT '経営ナビ' NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 4 NOT NULL,
	"tax_rounding" text DEFAULT 'FLOOR' NOT NULL,
	"issuer_address" text DEFAULT '' NOT NULL,
	"registration_number" text DEFAULT '' NOT NULL,
	"reserve_submitted_expenses" boolean DEFAULT true NOT NULL,
	"reserve_commitments" boolean DEFAULT true NOT NULL,
	"cash_horizon_days" integer DEFAULT 30 NOT NULL,
	"cash_warning_threshold" integer DEFAULT 0 NOT NULL,
	"outsourcing_ratio_limit" integer DEFAULT 60 NOT NULL,
	"statement_pay_day" integer DEFAULT 31 NOT NULL,
	"cleanup_url" text DEFAULT '' NOT NULL,
	"demo_data_loaded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_setting_singleton" CHECK ("company_setting"."id" = 1),
	CONSTRAINT "company_fy_month" CHECK ("company_setting"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"our_side" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"project_id" uuid,
	"driver_user_id" uuid,
	"template_id" uuid NOT NULL,
	"terms" jsonb NOT NULL,
	"rendered_body" text NOT NULL,
	"status" "contract_status" DEFAULT 'DRAFT' NOT NULL,
	"period_end" date,
	"renewal_notice_days" integer DEFAULT 30 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_file_id" uuid,
	"ended_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"terms" jsonb NOT NULL,
	"rendered_body" text NOT NULL,
	"template_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"status" "template_status" DEFAULT 'UNREVIEWED' NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assignment_id" uuid,
	"work_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"quantity" numeric(12, 2),
	"distance_km" numeric(12, 2),
	"notes" text DEFAULT '' NOT NULL,
	"status" "report_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"return_reason" text,
	"statement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_time" CHECK ("daily_report"."end_time" > "daily_report"."start_time"),
	CONSTRAINT "report_break" CHECK ("daily_report"."break_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_report_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "division" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "division_kind" DEFAULT 'GENERAL' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"outsourcing_ratio_limit" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "division_code_unique" UNIQUE("code"),
	CONSTRAINT "division_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "driver" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid,
	"division_id" uuid NOT NULL,
	"phone" text,
	"qualifications" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"vehicles" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"areas" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"max_days_per_month" integer,
	"max_minutes_per_day" integer,
	"withholding_enabled" boolean DEFAULT false NOT NULL,
	"withholding_confirmed_note" text,
	"tax_mode" text DEFAULT 'EXCLUSIVE' NOT NULL,
	"preferred_project_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"to_user_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "email_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"driver" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"used_on" date NOT NULL,
	"month" text NOT NULL,
	"division_id" uuid,
	"project_id" uuid,
	"category_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"payee" text NOT NULL,
	"purpose" text NOT NULL,
	"amount" integer NOT NULL,
	"tax_rate" integer DEFAULT 10 NOT NULL,
	"tax_amount" integer NOT NULL,
	"status" "expense_status" DEFAULT 'DRAFT' NOT NULL,
	"settlement" "settlement_method" DEFAULT 'SEPARATE' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"budget_exception_by_id" uuid,
	"budget_exception_note" text,
	"commitment_id" uuid,
	"statement_line_id" uuid,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_amount_positive" CHECK ("expense"."amount" > 0),
	CONSTRAINT "expense_tax_rate" CHECK ("expense"."tax_rate" in (0, 8, 10)),
	CONSTRAINT "expense_month" CHECK ("expense"."month" = to_char("expense"."used_on", 'YYYY-MM')),
	CONSTRAINT "expense_no_self_decision" CHECK ("expense"."decided_by_id" is null or "expense"."decided_by_id" <> "expense"."applicant_id" or "expense"."status" in ('DRAFT','SUBMITTED','CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "expense_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_outsourcing" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "expense_category_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_close" (
	"month" text PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"closed_by_id" uuid,
	"reopened_at" timestamp with time zone,
	"reopened_by_id" uuid,
	"reopen_reason" text,
	"is_closed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "partner_type" DEFAULT 'CORPORATION' NOT NULL,
	"name" text NOT NULL,
	"name_kana" text,
	"postal_code" text,
	"address" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_contractor" boolean DEFAULT false NOT NULL,
	"billing_info" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_has_role" CHECK ("partner"."is_customer" or "partner"."is_contractor")
);
--> statement-breakpoint
CREATE TABLE "partner_division" (
	"partner_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	CONSTRAINT "partner_division_partner_id_division_id_pk" PRIMARY KEY("partner_id","division_id")
);
--> statement-breakpoint
CREATE TABLE "partner_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"division_id" uuid,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "payable_source" NOT NULL,
	"source_id" uuid,
	"division_id" uuid,
	"payee_name" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" "payable_status" DEFAULT 'SCHEDULED' NOT NULL,
	"paid_on" date,
	"bank_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"division_id" uuid NOT NULL,
	"customer_id" uuid,
	"category" text DEFAULT '' NOT NULL,
	"contract_type" "contract_type" DEFAULT 'ONE_OFF' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"due_date" date,
	"status" "project_status" DEFAULT 'ACTIVE' NOT NULL,
	"report_fields" jsonb DEFAULT '{"quantity":false,"quantityUnit":"件","distance":false,"breakTime":true,"attachments":true}'::jsonb NOT NULL,
	"external_source" text,
	"external_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"driver_id" uuid,
	"method" "rate_method" NOT NULL,
	"unit_price" integer NOT NULL,
	"unit_label" text DEFAULT '' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_positive" CHECK ("rate"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	"bank_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "receipt_positive" CHECK ("receipt"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "reminder_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'AVAILABILITY' NOT NULL,
	"offset_days" integer NOT NULL,
	"hour" integer DEFAULT 9 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recognized_on" date NOT NULL,
	"month" text NOT NULL,
	"division_id" uuid NOT NULL,
	"customer_id" uuid,
	"project_id" uuid,
	"description" text NOT NULL,
	"amount_ex_tax" integer NOT NULL,
	"tax_rate" integer DEFAULT 10 NOT NULL,
	"tax_amount" integer NOT NULL,
	"billing_status" "billing_status" DEFAULT 'UNBILLED' NOT NULL,
	"expected_receipt_date" date,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"external_source" text,
	"external_id" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_tax_rate" CHECK ("sale"."tax_rate" in (0, 8, 10)),
	CONSTRAINT "sale_month" CHECK ("sale"."month" = to_char("sale"."recognized_on", 'YYYY-MM'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shift_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"required_count" integer DEFAULT 1 NOT NULL,
	"required_qualifications" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"required_vehicle" text,
	"area" text,
	"note" text,
	"status" "slot_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_time" CHECK ("shift_slot"."end_time" > "shift_slot"."start_time"),
	CONSTRAINT "slot_count" CHECK ("shift_slot"."required_count" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "statement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"month" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"correction_reason" text,
	"status" "statement_status" DEFAULT 'DRAFT' NOT NULL,
	"work_amount" integer DEFAULT 0 NOT NULL,
	"adjustment_amount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"withholding_amount" integer DEFAULT 0 NOT NULL,
	"expense_amount" integer DEFAULT 0 NOT NULL,
	"pay_amount" integer DEFAULT 0 NOT NULL,
	"pay_due_date" date,
	"snapshot" jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_id" uuid,
	"published_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"project_id" uuid,
	"division_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_inquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reply" text,
	"replied_by_id" uuid,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"kind" "statement_line_kind" NOT NULL,
	"division_id" uuid NOT NULL,
	"project_id" uuid,
	"work_date" date,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"rate_id" uuid,
	"report_id" uuid,
	"expense_id" uuid,
	"adjustment_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_file_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "user_division" (
	"user_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	CONSTRAINT "user_division_user_id_division_id_pk" PRIMARY KEY("user_id","division_id")
);
--> statement-breakpoint
ALTER TABLE "action_card" ADD CONSTRAINT "action_card_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_card" ADD CONSTRAINT "action_card_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_card" ADD CONSTRAINT "action_card_updated_by_id_app_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rule" ADD CONSTRAINT "allocation_rule_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_share" ADD CONSTRAINT "allocation_share_rule_id_allocation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."allocation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_share" ADD CONSTRAINT "allocation_share_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_approved_by_id_app_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_slot_id_shift_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."shift_slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_confirmed_by_id_app_user_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_change_request" ADD CONSTRAINT "availability_change_request_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_change_request" ADD CONSTRAINT "availability_change_request_decided_by_id_app_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_period" ADD CONSTRAINT "availability_period_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_submission" ADD CONSTRAINT "availability_submission_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_match" ADD CONSTRAINT "bank_match_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_match" ADD CONSTRAINT "bank_match_matched_by_id_app_user_id_fk" FOREIGN KEY ("matched_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_sync_run" ADD CONSTRAINT "bank_sync_run_account_id_bank_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_account_id_bank_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_adjustment" ADD CONSTRAINT "budget_adjustment_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_adjustment" ADD CONSTRAINT "budget_adjustment_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_adjustment" ADD CONSTRAINT "budget_adjustment_request_id_budget_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."budget_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_adjustment" ADD CONSTRAINT "budget_adjustment_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment" ADD CONSTRAINT "budget_commitment_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment" ADD CONSTRAINT "budget_commitment_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment" ADD CONSTRAINT "budget_commitment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment" ADD CONSTRAINT "budget_commitment_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_request" ADD CONSTRAINT "budget_request_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_request" ADD CONSTRAINT "budget_request_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_request" ADD CONSTRAINT "budget_request_requested_by_id_app_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_request" ADD CONSTRAINT "budget_request_decided_by_id_app_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_rule" ADD CONSTRAINT "budget_rule_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_rule" ADD CONSTRAINT "budget_rule_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_rule" ADD CONSTRAINT "budget_rule_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_driver_user_id_app_user_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_template_id_contract_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_reviewed_by_id_app_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision" ADD CONSTRAINT "contract_revision_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision" ADD CONSTRAINT "contract_revision_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_template" ADD CONSTRAINT "contract_template_approved_by_id_app_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_decided_by_id_app_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_revision" ADD CONSTRAINT "daily_report_revision_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_revision" ADD CONSTRAINT "daily_report_revision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_to_user_id_app_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_applicant_id_app_user_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_decided_by_id_app_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_budget_exception_by_id_app_user_id_fk" FOREIGN KEY ("budget_exception_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_close" ADD CONSTRAINT "month_close_closed_by_id_app_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_close" ADD CONSTRAINT "month_close_reopened_by_id_app_user_id_fk" FOREIGN KEY ("reopened_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_division" ADD CONSTRAINT "partner_division_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_division" ADD CONSTRAINT "partner_division_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_note" ADD CONSTRAINT "partner_note_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_note" ADD CONSTRAINT "partner_note_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_note" ADD CONSTRAINT "partner_note_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payable" ADD CONSTRAINT "payable_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_customer_id_partner_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_id_partner_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_slot" ADD CONSTRAINT "shift_slot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_supersedes_id_statement_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."statement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_confirmed_by_id_app_user_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_adjustment" ADD CONSTRAINT "statement_adjustment_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_adjustment" ADD CONSTRAINT "statement_adjustment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_adjustment" ADD CONSTRAINT "statement_adjustment_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_adjustment" ADD CONSTRAINT "statement_adjustment_approved_by_id_app_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_adjustment" ADD CONSTRAINT "statement_adjustment_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_inquiry" ADD CONSTRAINT "statement_inquiry_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_inquiry" ADD CONSTRAINT "statement_inquiry_driver_id_app_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_inquiry" ADD CONSTRAINT "statement_inquiry_replied_by_id_app_user_id_fk" FOREIGN KEY ("replied_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_uploaded_by_id_app_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_division" ADD CONSTRAINT "user_division_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_division" ADD CONSTRAINT "user_division_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_card_rule_target_uq" ON "action_card" USING btree ("rule_key","target_key");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_uq" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_slot_driver_uq" ON "assignment" USING btree ("slot_id","driver_id") WHERE "assignment"."status" <> 'CANCELED';--> statement-breakpoint
CREATE INDEX "assignment_driver_day_idx" ON "assignment" USING btree ("driver_id","work_date");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_driver_day_uq" ON "availability" USING btree ("driver_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_match_target_uq" ON "bank_match" USING btree ("target_type","target_id") WHERE "bank_match"."unmatched_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_txn_external_uq" ON "bank_transaction" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "bank_txn_date_idx" ON "bank_transaction" USING btree ("txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "template_key_version_uq" ON "contract_template" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_report_driver_project_day_uq" ON "daily_report" USING btree ("driver_id","project_id","work_date");--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_statement_line_uq" ON "expense" USING btree ("statement_line_id") WHERE "expense"."statement_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_external_uq" ON "expense" USING btree ("external_source","external_id") WHERE "expense"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "expense_month_idx" ON "expense" USING btree ("month","division_id");--> statement-breakpoint
CREATE INDEX "expense_status_idx" ON "expense" USING btree ("status");--> statement-breakpoint
CREATE INDEX "login_attempt_key_idx" ON "login_attempt" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX "partner_name_idx" ON "partner" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "payable_source_uq" ON "payable" USING btree ("source","source_id") WHERE "payable"."source_id" is not null and "payable"."status" <> 'CANCELED';--> statement-breakpoint
CREATE UNIQUE INDEX "project_external_uq" ON "project" USING btree ("external_source","external_id") WHERE "project"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "project_division_idx" ON "project" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "rate_lookup_idx" ON "rate" USING btree ("project_id","driver_id","effective_from");--> statement-breakpoint
CREATE INDEX "receipt_sale_idx" ON "receipt" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_external_uq" ON "sale" USING btree ("external_source","external_id") WHERE "sale"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "sale_month_idx" ON "sale" USING btree ("month","division_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slot_date_idx" ON "shift_slot" USING btree ("work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_active_uq" ON "statement" USING btree ("driver_id","month") WHERE "statement"."status" <> 'SUPERSEDED';--> statement-breakpoint
CREATE INDEX "statement_line_stmt_idx" ON "statement_line" USING btree ("statement_id");