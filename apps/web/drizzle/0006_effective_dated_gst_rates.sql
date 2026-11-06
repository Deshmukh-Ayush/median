CREATE TABLE "hsn_sac_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hsn_sac_codes_code_check" CHECK ("hsn_sac_codes"."code" ~ '^([0-9]{2}|[0-9]{4}|[0-9]{6}|[0-9]{8})$'),
	CONSTRAINT "hsn_sac_codes_kind_check" CHECK (("hsn_sac_codes"."kind" = 'sac') = ("hsn_sac_codes"."code" like '99%'))
);
--> statement-breakpoint
CREATE TABLE "hsn_sac_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"condition" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hsn_sac_rates_code_from_condition_uq" UNIQUE NULLS NOT DISTINCT("code","effective_from","condition"),
	CONSTRAINT "hsn_sac_rates_rate_check" CHECK ("hsn_sac_rates"."gst_rate_bps" between 0 and 10000),
	CONSTRAINT "hsn_sac_rates_window_check" CHECK ("hsn_sac_rates"."effective_to" is null or "hsn_sac_rates"."effective_from" <= "hsn_sac_rates"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "organization_default_gst_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_default_gst_rates_org_from_uq" UNIQUE NULLS NOT DISTINCT("organization_id","effective_from"),
	CONSTRAINT "organization_default_gst_rates_rate_check" CHECK ("organization_default_gst_rates"."gst_rate_bps" between 0 and 10000),
	CONSTRAINT "organization_default_gst_rates_window_check" CHECK ("organization_default_gst_rates"."effective_from" is null or "organization_default_gst_rates"."effective_to" is null or "organization_default_gst_rates"."effective_from" <= "organization_default_gst_rates"."effective_to")
);
--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" DROP CONSTRAINT "gst_rate_mappings_org_kind_key_uq";--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD COLUMN "effective_from" date;--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD COLUMN "effective_to" date;--> statement-breakpoint
ALTER TABLE "hsn_sac_rates" ADD CONSTRAINT "hsn_sac_rates_code_hsn_sac_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."hsn_sac_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_default_gst_rates" ADD CONSTRAINT "organization_default_gst_rates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_default_gst_rates" ADD CONSTRAINT "organization_default_gst_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hsn_sac_rates_code_from_idx" ON "hsn_sac_rates" USING btree ("code","effective_from");--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD CONSTRAINT "gst_rate_mappings_org_kind_key_from_uq" UNIQUE NULLS NOT DISTINCT("organization_id","kind","key","effective_from");--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD CONSTRAINT "gst_rate_mappings_window_check" CHECK ("gst_rate_mappings"."effective_from" is null or "gst_rate_mappings"."effective_to" is null or "gst_rate_mappings"."effective_from" <= "gst_rate_mappings"."effective_to");