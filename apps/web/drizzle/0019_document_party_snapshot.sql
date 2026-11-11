-- Invoices and credit notes keep the customer as printed when issued, so a
-- later edit to the party doesn't change an issued document, its PDF or
-- GSTR-1. Existing rows are backfilled from the party as it is now (invoices)
-- and from their invoice (credit notes), then the name becomes required.
ALTER TABLE "credit_notes" ADD COLUMN "party_name" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "party_gstin" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "party_address" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "party_state_code" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "party_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "party_gstin" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "party_address" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "party_state_code" text;--> statement-breakpoint
UPDATE "invoices" AS i SET
  "party_name" = coalesce(p."legal_name", p."name"),
  "party_gstin" = p."gstin",
  "party_address" = p."billing_address",
  "party_state_code" = p."state_code"
FROM "parties" AS p
WHERE p."organization_id" = i."organization_id" AND p."id" = i."party_id";--> statement-breakpoint
UPDATE "credit_notes" AS c SET
  "party_name" = i."party_name",
  "party_gstin" = i."party_gstin",
  "party_address" = i."party_address",
  "party_state_code" = i."party_state_code"
FROM "invoices" AS i
WHERE i."organization_id" = c."organization_id" AND i."id" = c."invoice_id";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "party_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "party_name" SET NOT NULL;
