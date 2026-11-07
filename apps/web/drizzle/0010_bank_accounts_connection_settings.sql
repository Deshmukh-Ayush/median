ALTER TABLE "connections" ADD COLUMN "settlement_bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "fee_gst_state_code" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "account_last4" text;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_settlement_bank_fk" FOREIGN KEY ("organization_id","settlement_bank_account_id") REFERENCES "public"."ledger_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_fee_gst_state_check" CHECK ("connections"."fee_gst_state_code" is null or "connections"."fee_gst_state_code" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_last4_check" CHECK ("ledger_accounts"."account_last4" is null or "ledger_accounts"."account_last4" ~ '^[0-9]{4}$');