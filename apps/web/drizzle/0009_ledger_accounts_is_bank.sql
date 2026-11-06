ALTER TABLE "ledger_accounts" ADD COLUMN "is_bank" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The template's bank account in orgs seeded before this flag existed.
UPDATE "ledger_accounts" SET "is_bank" = true WHERE "system_key" = 'bank_default';
