ALTER TABLE "inbox_items" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_org_name_idx" ON "parties" USING btree ("organization_id","name","id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credited_check" CHECK ("invoices"."credited_paise" >= 0 and "invoices"."credited_paise" <= "invoices"."total_paise");