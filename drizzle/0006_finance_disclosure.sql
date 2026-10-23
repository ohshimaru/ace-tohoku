CREATE TYPE "public"."txn_confirm_status" AS ENUM('UNCONFIRMED', 'CONFIRMED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."txn_publish_status" AS ENUM('DRAFT', 'PUBLISHED', 'SUSPENDED');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'PROVIDER';--> statement-breakpoint
CREATE TABLE "bank_txn_audience" (
	"transaction_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "bank_txn_audience_transaction_id_kind_target_id_pk" PRIMARY KEY("transaction_id","kind","target_id"),
	CONSTRAINT "bank_txn_audience_kind" CHECK ("bank_txn_audience"."kind" in ('USER', 'DIVISION'))
);
--> statement-breakpoint
CREATE TABLE "bank_txn_correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "company" ("id", "name", "is_self") SELECT '00000000-0000-4000-8000-000000000001', coalesce((SELECT company_name FROM company_setting WHERE id = 1), '株式会社エースナンバー東北'), true;--> statement-breakpoint
CREATE UNIQUE INDEX "company_one_self_uq" ON "company" ("is_self") WHERE "is_self";--> statement-breakpoint
CREATE TABLE "disclosure_policy" (
	"company_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"view_details" boolean NOT NULL,
	"view_real_balance" boolean NOT NULL,
	"view_all_totals" boolean NOT NULL,
	"view_published_totals" boolean NOT NULL,
	"can_export" boolean NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_policy_company_id_subject_pk" PRIMARY KEY("company_id","subject")
);
--> statement-breakpoint
CREATE TABLE "provider_assignment" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_assignment_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "source" text DEFAULT 'CSV' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "publish_status" "txn_publish_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "hq_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "staff_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "exclude_reason" text;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "confirm_status" "txn_confirm_status" DEFAULT 'UNCONFIRMED' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "updated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_txn_audience" ADD CONSTRAINT "bank_txn_audience_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_txn_correction" ADD CONSTRAINT "bank_txn_correction_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_txn_correction" ADD CONSTRAINT "bank_txn_correction_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_policy" ADD CONSTRAINT "disclosure_policy_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_policy" ADD CONSTRAINT "disclosure_policy_updated_by_id_app_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assignment" ADD CONSTRAINT "provider_assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assignment" ADD CONSTRAINT "provider_assignment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_txn_correction_txn_idx" ON "bank_txn_correction" USING btree ("transaction_id","created_at");--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_updated_by_id_app_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "bank_transaction" t SET "source" = a."provider" FROM "bank_account" a WHERE a."id" = t."account_id";--> statement-breakpoint
CREATE INDEX "bank_txn_visibility_idx" ON "bank_transaction" ("account_id", "publish_status", "hq_visible", "staff_visible");--> statement-breakpoint
CREATE INDEX "bank_txn_audience_target_idx" ON "bank_txn_audience" ("kind", "target_id");--> statement-breakpoint
-- 銀行から取得した原本（口座・日付・金額・内容・残高・取引ID・取込日時・取得元）は変更・削除できない。訂正は bank_txn_correction に追記する
CREATE OR REPLACE FUNCTION bank_txn_original_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_transaction は削除できません（集計対象外の設定を使ってください）' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.txn_date IS DISTINCT FROM OLD.txn_date OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.balance_after IS DISTINCT FROM OLD.balance_after
     OR NEW.external_id IS DISTINCT FROM OLD.external_id OR NEW.imported_at IS DISTINCT FROM OLD.imported_at OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION '入出金の原本は変更できません（訂正を追加してください）' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bank_txn_original_guard BEFORE UPDATE OR DELETE ON "bank_transaction" FOR EACH ROW EXECUTE FUNCTION bank_txn_original_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION bank_txn_correction_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '訂正の記録は変更・削除できません' USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bank_txn_correction_append_only BEFORE UPDATE OR DELETE ON "bank_txn_correction" FOR EACH ROW EXECUTE FUNCTION bank_txn_correction_append_only();--> statement-breakpoint
-- 表示・集計に使う値（最新の訂正があればその値、なければ原本）
CREATE VIEW "bank_txn_effective" AS
SELECT t.id, a.company_id, t.account_id, t.txn_date AS original_date, t.amount AS original_amount, t.description AS original_description,
  coalesce(c.txn_date, t.txn_date) AS eff_date, coalesce(c.amount, t.amount) AS eff_amount, coalesce(c.description, t.description) AS eff_description,
  (c.id IS NOT NULL) AS corrected
FROM "bank_transaction" t
JOIN "bank_account" a ON a.id = t.account_id
LEFT JOIN LATERAL (SELECT x.id, x.txn_date, x.amount, x.description FROM "bank_txn_correction" x WHERE x.transaction_id = t.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1) c ON true;
