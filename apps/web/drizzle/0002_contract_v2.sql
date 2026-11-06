CREATE TYPE "public"."business_type" AS ENUM('saas', 'd2c', 'agency');--> statement-breakpoint
CREATE TYPE "public"."connector_auth_type" AS ENUM('api_key', 'oauth', 'file');--> statement-breakpoint
CREATE TYPE "public"."credit_note_reason" AS ENUM('refund', 'sales_return', 'post_sale_discount', 'deficiency_in_service', 'correction');--> statement-breakpoint
CREATE TYPE "public"."gst_rate_mapping_kind" AS ENUM('product', 'stream');--> statement-breakpoint
CREATE TYPE "public"."supply_type" AS ENUM('intrastate', 'interstate', 'export_with_payment', 'export_lut', 'sez');--> statement-breakpoint
ALTER TYPE "public"."source_record_kind" ADD VALUE 'order';--> statement-breakpoint
ALTER TYPE "public"."source_record_kind" ADD VALUE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."source_record_kind" ADD VALUE 'party';--> statement-breakpoint
ALTER TYPE "public"."source_record_kind" ADD VALUE 'opening_balance';--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"consent_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_org_user_version_uq" UNIQUE("organization_id","user_id","consent_version")
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"invoice_line_id" uuid,
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
	CONSTRAINT "credit_note_lines_org_note_line_uq" UNIQUE("organization_id","credit_note_id","line_no"),
	CONSTRAINT "credit_note_lines_amounts_check" CHECK ("credit_note_lines"."quantity_milli" > 0 and "credit_note_lines"."unit_price_paise" >= 0 and "credit_note_lines"."gst_rate_bps" between 0 and 10000 and "credit_note_lines"."total_paise" = "credit_note_lines"."taxable_paise" + "credit_note_lines"."cgst_paise" + "credit_note_lines"."sgst_paise" + "credit_note_lines"."igst_paise")
);
--> statement-breakpoint
CREATE TABLE "credit_note_series" (
	"organization_id" text NOT NULL,
	"financial_year" text NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_series_organization_id_financial_year_pk" PRIMARY KEY("organization_id","financial_year"),
	CONSTRAINT "credit_note_series_fy_check" CHECK ("credit_note_series"."financial_year" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"credit_note_date" date NOT NULL,
	"reason" "credit_note_reason" NOT NULL,
	"place_of_supply" text NOT NULL,
	"supply_type" "supply_type" NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"source_record_id" uuid,
	"notes" text,
	"journal_entry_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "credit_notes_org_fy_number_uq" UNIQUE("organization_id","financial_year","number"),
	CONSTRAINT "credit_notes_amounts_check" CHECK ("credit_notes"."taxable_paise" >= 0 and "credit_notes"."cgst_paise" >= 0 and "credit_notes"."sgst_paise" >= 0 and "credit_notes"."igst_paise" >= 0 and "credit_notes"."round_off_paise" between -50 and 50 and "credit_notes"."total_paise" = "credit_notes"."taxable_paise" + "credit_notes"."cgst_paise" + "credit_notes"."sgst_paise" + "credit_notes"."igst_paise" + "credit_notes"."round_off_paise"),
	CONSTRAINT "credit_notes_number_length_check" CHECK (char_length("credit_notes"."number") between 1 and 16),
	CONSTRAINT "credit_notes_place_of_supply_check" CHECK ("credit_notes"."place_of_supply" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "deletion_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"organization_name" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted" jsonb NOT NULL,
	"retained" jsonb NOT NULL,
	"retention_until" date NOT NULL,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_rate_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "gst_rate_mapping_kind" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"hsn_sac" text,
	"gst_rate_bps" integer NOT NULL,
	"revenue_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_rate_mappings_org_kind_key_uq" UNIQUE("organization_id","kind","key"),
	CONSTRAINT "gst_rate_mappings_rate_check" CHECK ("gst_rate_mappings"."gst_rate_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_org_number_uq";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amounts_check";--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'connected'::text;--> statement-breakpoint
DROP TYPE "public"."connection_status";--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'syncing', 'error', 'disconnected');--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'connected'::"public"."connection_status";--> statement-breakpoint
-- Hand-edited: rows written under 0000 used 'active', now 'connected'.
ALTER TABLE "connections" ALTER COLUMN "status" SET DATA TYPE "public"."connection_status" USING (CASE WHEN "status" = 'active' THEN 'connected' ELSE "status" END)::"public"."connection_status";--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_records" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_records" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
-- Hand-edited: existing connections (Razorpay keys) are api_key; no default afterwards.
ALTER TABLE "connections" ADD COLUMN "auth_type" "connector_auth_type" DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "auth_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "cursor" jsonb;--> statement-breakpoint
-- No invoice rows exist yet (createInvoice was a stub before this migration).
ALTER TABLE "invoices" ADD COLUMN "supply_type" "supply_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reverse_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "round_off_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "business_type" "business_type" DEFAULT 'saas' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "gst_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "composition_scheme" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "default_gst_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "dedupe_hash" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
-- Hand-edited: created before credit_notes_source_record_fk, which references it.
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_org_id_uq" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_note_fk" FOREIGN KEY ("organization_id","credit_note_id") REFERENCES "public"."credit_notes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_series" ADD CONSTRAINT "credit_note_series_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_party_fk" FOREIGN KEY ("organization_id","party_id") REFERENCES "public"."parties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_source_record_fk" FOREIGN KEY ("organization_id","source_record_id") REFERENCES "public"."source_records"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD CONSTRAINT "gst_rate_mappings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD CONSTRAINT "gst_rate_mappings_revenue_account_fk" FOREIGN KEY ("organization_id","revenue_account_id") REFERENCES "public"."ledger_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_org_version_accepted_idx" ON "consents" USING btree ("organization_id","consent_version","accepted_at");--> statement-breakpoint
CREATE INDEX "credit_notes_org_date_idx" ON "credit_notes" USING btree ("organization_id","credit_note_date","id");--> statement-breakpoint
CREATE INDEX "credit_notes_org_invoice_idx" ON "credit_notes" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_source_record_uq" ON "credit_notes" USING btree ("organization_id","source_record_id") WHERE "credit_notes"."source_record_id" is not null;--> statement-breakpoint
CREATE INDEX "deletion_tombstones_org_idx" ON "deletion_tombstones" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deletion_tombstones_retention_idx" ON "deletion_tombstones" USING btree ("retention_until") WHERE "deletion_tombstones"."purged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_org_dedupe_hash_uq" ON "source_records" USING btree ("organization_id","dedupe_hash") WHERE "source_records"."dedupe_hash" is not null;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_fy_number_uq" UNIQUE("organization_id","financial_year","number");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_length_check" CHECK (char_length("invoices"."number") between 1 and 16);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."taxable_paise" >= 0 and "invoices"."cgst_paise" >= 0 and "invoices"."sgst_paise" >= 0 and "invoices"."igst_paise" >= 0 and "invoices"."paid_paise" >= 0 and "invoices"."round_off_paise" between -50 and 50 and "invoices"."total_paise" = "invoices"."taxable_paise" + "invoices"."cgst_paise" + "invoices"."sgst_paise" + "invoices"."igst_paise" + "invoices"."round_off_paise");--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_default_rate_check" CHECK ("organization_settings"."default_gst_rate_bps" is null or "organization_settings"."default_gst_rate_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_gstin_when_registered_check" CHECK (not "organization_settings"."gst_registered" or "organization_settings"."gstin" is not null);--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_identity_check" CHECK ("source_records"."external_id" is not null or "source_records"."dedupe_hash" is not null);--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_currency_check" CHECK ("source_records"."currency" ~ '^[A-Z]{3}$');