-- Copy data from columns renamed in contract v2 before 0004 drops the old ones.
UPDATE "organization_settings" SET "business_type" = "industry"::text::"business_type";
--> statement-breakpoint
UPDATE "connections" SET "cursor" = "sync_cursor" WHERE "sync_cursor" IS NOT NULL;
