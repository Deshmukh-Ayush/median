CREATE TYPE "public"."bill_allocation_kind" AS ENUM('payment', 'advance');--> statement-breakpoint
CREATE TABLE "bill_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"bill_id" uuid NOT NULL,
	"kind" "bill_allocation_kind" NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_allocations_amount_check" CHECK ("bill_allocations"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"party_id" uuid NOT NULL,
	"number" text NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"total_paise" bigint NOT NULL,
	"settled_paise" bigint DEFAULT 0 NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"inbox_item_id" uuid,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "bills_org_entry_uq" UNIQUE("organization_id","journal_entry_id"),
	CONSTRAINT "bills_amounts_check" CHECK ("bills"."total_paise" > 0 and "bills"."settled_paise" between 0 and "bills"."total_paise")
);
--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_bill_fk" FOREIGN KEY ("organization_id","bill_id") REFERENCES "public"."bills"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_party_fk" FOREIGN KEY ("organization_id","party_id") REFERENCES "public"."parties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_allocations_org_bill_idx" ON "bill_allocations" USING btree ("organization_id","bill_id");--> statement-breakpoint
CREATE INDEX "bills_org_party_date_idx" ON "bills" USING btree ("organization_id","party_id","bill_date","id");--> statement-breakpoint
CREATE INDEX "bills_org_date_idx" ON "bills" USING btree ("organization_id","bill_date","id");--> statement-breakpoint
-- Existing organisations: their template's "Advances to vendors" (1300)
-- becomes the system account that vendor advances post to.
UPDATE "ledger_accounts" SET "system_key" = 'vendor_advances', "is_system" = true
WHERE "code" = '1300' AND "system_key" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ledger_accounts" AS a
    WHERE a."organization_id" = "ledger_accounts"."organization_id"
      AND a."system_key" = 'vendor_advances'
  );
