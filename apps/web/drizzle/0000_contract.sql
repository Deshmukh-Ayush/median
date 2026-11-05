CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."connection_provider" AS ENUM('razorpay', 'bank');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('bill', 'bank_statement');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'extracting', 'extracted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flow_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TYPE "public"."inbox_item_kind" AS ENUM('bill', 'bank_line', 'razorpay_record', 'settlement_gap');--> statement-breakpoint
CREATE TYPE "public"."inbox_source_type" AS ENUM('document', 'source_record');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."industry_template" AS ENUM('saas', 'd2c', 'agency');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'partially_paid', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."journal_source_type" AS ENUM('manual', 'razorpay', 'bank', 'invoice', 'bill', 'inbox', 'reversal', 'opening_balance');--> statement-breakpoint
CREATE TYPE "public"."party_kind" AS ENUM('customer', 'vendor');--> statement-breakpoint
CREATE TYPE "public"."source_record_kind" AS ENUM('payment', 'refund', 'fee', 'settlement', 'payout', 'bank_line');--> statement-breakpoint
CREATE TYPE "public"."source_record_status" AS ENUM('new', 'posted', 'inbox', 'ignored');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"source" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"label" text NOT NULL,
	"credentials_encrypted" text,
	"key_hint" text,
	"ledger_account_id" uuid,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"sync_cursor" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"blob_url" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"extracted" jsonb,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "inbox_item_kind" NOT NULL,
	"proposed_entry" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "inbox_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"posted_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_org_source_uq" UNIQUE("organization_id","source_type","source_id"),
	CONSTRAINT "inbox_items_confidence_check" CHECK ("inbox_items"."confidence" >= 0 and "inbox_items"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"hsn_sac" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_org_invoice_line_uq" UNIQUE("organization_id","invoice_id","line_no"),
	CONSTRAINT "invoice_lines_amounts_check" CHECK ("invoice_lines"."quantity_milli" > 0 and "invoice_lines"."unit_price_paise" >= 0 and "invoice_lines"."gst_rate_bps" between 0 and 10000 and "invoice_lines"."total_paise" = "invoice_lines"."taxable_paise" + "invoice_lines"."cgst_paise" + "invoice_lines"."sgst_paise" + "invoice_lines"."igst_paise")
);
--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"organization_id" text NOT NULL,
	"financial_year" text NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_series_organization_id_financial_year_pk" PRIMARY KEY("organization_id","financial_year"),
	CONSTRAINT "invoice_series_fy_check" CHECK ("invoice_series"."financial_year" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"party_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"place_of_supply" text NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_org_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."taxable_paise" >= 0 and "invoices"."cgst_paise" >= 0 and "invoices"."sgst_paise" >= 0 and "invoices"."igst_paise" >= 0 and "invoices"."paid_paise" >= 0 and "invoices"."total_paise" = "invoices"."taxable_paise" + "invoices"."cgst_paise" + "invoices"."sgst_paise" + "invoices"."igst_paise"),
	CONSTRAINT "invoices_place_of_supply_check" CHECK ("invoices"."place_of_supply" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"narration" text NOT NULL,
	"source_type" "journal_source_type" NOT NULL,
	"source_id" text,
	"reverses_entry_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"entry_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"party_id" uuid,
	"debit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"dimensions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_org_entry_line_uq" UNIQUE("organization_id","entry_id","line_no"),
	CONSTRAINT "journal_lines_one_sided_check" CHECK ("journal_lines"."debit_paise" >= 0 and "journal_lines"."credit_paise" >= 0 and ("journal_lines"."debit_paise" = 0) <> ("journal_lines"."credit_paise" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"parent_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ledger_accounts_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"legal_name" text,
	"gstin" text,
	"state_code" text,
	"industry" "industry_template" DEFAULT 'saas' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_state_code_check" CHECK ("organization_settings"."state_code" is null or "organization_settings"."state_code" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "party_kind" NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"state_code" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "parties_state_code_check" CHECK ("parties"."state_code" is null or "parties"."state_code" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "period_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"period" text NOT NULL,
	"locked_by" text NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_locks_org_period_uq" UNIQUE("organization_id","period"),
	CONSTRAINT "period_locks_period_check" CHECK ("period_locks"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"external_id" text NOT NULL,
	"kind" "source_record_kind" NOT NULL,
	"direction" "flow_direction" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reference" text,
	"settlement_external_id" text,
	"status" "source_record_status" DEFAULT 'new' NOT NULL,
	"journal_entry_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_records_org_provider_external_uq" UNIQUE("organization_id","provider","external_id"),
	CONSTRAINT "source_records_amount_check" CHECK ("source_records"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_ledger_account_fk" FOREIGN KEY ("organization_id","ledger_account_id") REFERENCES "public"."ledger_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_posted_entry_fk" FOREIGN KEY ("organization_id","posted_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_fk" FOREIGN KEY ("organization_id","party_id") REFERENCES "public"."parties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("organization_id","reverses_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("organization_id","entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."ledger_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_fk" FOREIGN KEY ("organization_id","party_id") REFERENCES "public"."parties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parent_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "public"."ledger_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("organization_id","at","id");--> statement-breakpoint
CREATE INDEX "audit_log_org_entity_idx" ON "audit_log" USING btree ("organization_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "connections_org_provider_idx" ON "connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "documents_org_created_idx" ON "documents" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_org_status_idx" ON "documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "inbox_items_org_status_created_idx" ON "inbox_items" USING btree ("organization_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "invoices_org_date_idx" ON "invoices" USING btree ("organization_id","invoice_date","id");--> statement-breakpoint
CREATE INDEX "invoices_org_party_date_idx" ON "invoices" USING btree ("organization_id","party_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_org_status_due_idx" ON "invoices" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("organization_id","entry_date","id");--> statement-breakpoint
CREATE INDEX "journal_entries_org_source_idx" ON "journal_entries" USING btree ("organization_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_reverses_uq" ON "journal_entries" USING btree ("organization_id","reverses_entry_id") WHERE "journal_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_date_idx" ON "journal_lines" USING btree ("organization_id","account_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_org_party_date_idx" ON "journal_lines" USING btree ("organization_id","party_id","entry_date") WHERE "journal_lines"."party_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_org_system_key_uq" ON "ledger_accounts" USING btree ("organization_id","system_key") WHERE "ledger_accounts"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "ledger_accounts_org_type_idx" ON "ledger_accounts" USING btree ("organization_id","type");--> statement-breakpoint
CREATE INDEX "ledger_accounts_org_parent_idx" ON "ledger_accounts" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_kind_gstin_uq" ON "parties" USING btree ("organization_id","kind","gstin") WHERE "parties"."gstin" is not null;--> statement-breakpoint
CREATE INDEX "parties_org_gstin_idx" ON "parties" USING btree ("organization_id","gstin");--> statement-breakpoint
CREATE INDEX "parties_org_kind_name_idx" ON "parties" USING btree ("organization_id","kind","name");--> statement-breakpoint
CREATE INDEX "source_records_org_kind_occurred_idx" ON "source_records" USING btree ("organization_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "source_records_org_status_occurred_idx" ON "source_records" USING btree ("organization_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "source_records_org_settlement_idx" ON "source_records" USING btree ("organization_id","settlement_external_id") WHERE "source_records"."settlement_external_id" is not null;--> statement-breakpoint
CREATE INDEX "source_records_org_connection_occurred_idx" ON "source_records" USING btree ("organization_id","connection_id","occurred_at");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organization_id_user_id_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");