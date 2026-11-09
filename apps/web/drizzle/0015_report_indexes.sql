DROP INDEX "journal_lines_org_account_date_idx";--> statement-breakpoint
DROP INDEX "journal_lines_org_party_date_idx";--> statement-breakpoint
CREATE INDEX "journal_entries_org_source_date_idx" ON "journal_entries" USING btree ("organization_id","source_type","entry_date","id");--> statement-breakpoint
CREATE INDEX "journal_lines_org_date_cover_idx" ON "journal_lines" USING btree ("organization_id","entry_date","account_id","debit_paise","credit_paise");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_date_idx" ON "journal_lines" USING btree ("organization_id","account_id","entry_date","entry_id","debit_paise","credit_paise");--> statement-breakpoint
CREATE INDEX "journal_lines_org_party_date_idx" ON "journal_lines" USING btree ("organization_id","party_id","entry_date","entry_id") WHERE "journal_lines"."party_id" is not null;