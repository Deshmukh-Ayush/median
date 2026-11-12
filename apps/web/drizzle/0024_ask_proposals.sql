ALTER TYPE "public"."inbox_item_kind" ADD VALUE 'ask_proposal';--> statement-breakpoint
ALTER TYPE "public"."inbox_source_type" ADD VALUE 'conversation';--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "proposal" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "conversation_id" text;