ALTER TYPE "public"."connection_status" ADD VALUE 'reconnect_required' BEFORE 'disconnected';--> statement-breakpoint
ALTER TYPE "public"."connection_status" ADD VALUE 'revoked' BEFORE 'disconnected';