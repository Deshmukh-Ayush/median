ALTER TABLE "connections" DROP COLUMN "sync_cursor";--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN "industry";--> statement-breakpoint
DROP TYPE "public"."connection_provider";--> statement-breakpoint
DROP TYPE "public"."industry_template";