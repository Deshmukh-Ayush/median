-- The ledger and the audit trail are append-only. Corrections are reversal
-- entries; nothing posted is ever updated or deleted. This backs up the rule
-- in code at the database level.

CREATE OR REPLACE FUNCTION median_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION median_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION median_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION median_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate
  BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION median_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_truncate
  BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION median_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION median_reject_mutation();
