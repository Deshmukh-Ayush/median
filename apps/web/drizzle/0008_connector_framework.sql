ALTER TABLE "inbox_items" ADD COLUMN "gst" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "tds" jsonb;--> statement-breakpoint
CREATE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("organization_id","number");