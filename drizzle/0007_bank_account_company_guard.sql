-- Custom SQL migration file, put your code below! ---- 口座の所属会社は変更できない（他社への付け替えで担当外の提供者・本社に見えるのを防ぐ）
CREATE OR REPLACE FUNCTION bank_account_company_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION '口座の所属会社は変更できません' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bank_account_company_guard BEFORE UPDATE ON "bank_account" FOR EACH ROW EXECUTE FUNCTION bank_account_company_guard();
