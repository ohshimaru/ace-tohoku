-- 同じドライバーに時間帯が重なる割当を作れないようにする（下書き・確定の両方。取消は除く）
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE assignment ADD CONSTRAINT assignment_no_overlap
  EXCLUDE USING gist (driver_id WITH =, tsrange(work_date + start_time, work_date + end_time) WITH &&)
  WHERE (status <> 'CANCELED');
--> statement-breakpoint
-- 日報も同じドライバーで時間帯の重複を禁止
ALTER TABLE daily_report ADD CONSTRAINT daily_report_no_overlap
  EXCLUDE USING gist (driver_id WITH =, tsrange(work_date + start_time, work_date + end_time) WITH &&);
--> statement-breakpoint
INSERT INTO reminder_rule (kind, offset_days, hour, enabled) VALUES
  ('AVAILABILITY', -3, 9, true), ('AVAILABILITY', -1, 9, true), ('AVAILABILITY', 0, 9, true), ('AVAILABILITY', 1, 9, true);
