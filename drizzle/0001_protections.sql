-- 監査ログは追記のみ
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log は変更・削除できません';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
-- 確定・公開済みの稼働明細は金額を変更できない（訂正は新しい版で行う）
CREATE OR REPLACE FUNCTION statement_locked() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('CONFIRMED','PUBLISHED','SUPERSEDED') AND (
     NEW.work_amount <> OLD.work_amount OR NEW.adjustment_amount <> OLD.adjustment_amount OR NEW.tax_amount <> OLD.tax_amount
     OR NEW.withholding_amount <> OLD.withholding_amount OR NEW.expense_amount <> OLD.expense_amount OR NEW.pay_amount <> OLD.pay_amount
     OR NEW.driver_id <> OLD.driver_id OR NEW.month <> OLD.month) THEN
    RAISE EXCEPTION '確定済みの稼働明細の金額は変更できません';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER statement_lock BEFORE UPDATE ON statement FOR EACH ROW EXECUTE FUNCTION statement_locked();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION statement_line_locked() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM statement WHERE id = COALESCE(NEW.statement_id, OLD.statement_id);
  IF s IN ('CONFIRMED','PUBLISHED','SUPERSEDED') THEN
    RAISE EXCEPTION '確定済みの稼働明細の行は変更できません';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER statement_line_lock BEFORE INSERT OR UPDATE OR DELETE ON statement_line FOR EACH ROW EXECUTE FUNCTION statement_line_locked();
--> statement-breakpoint
INSERT INTO company_setting (id) VALUES (1) ON CONFLICT DO NOTHING;
