CREATE TYPE "public"."msme_category" AS ENUM('micro', 'small', 'medium');--> statement-breakpoint
CREATE TYPE "public"."party_registration_type" AS ENUM('regular', 'composition', 'unregistered', 'sez', 'overseas');--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "pan" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "registration_type" "party_registration_type" DEFAULT 'unregistered' NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "default_tds_section" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "msme_category" "msme_category";--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "udyam_number" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Backfill before the checks: a party with a GSTIN is a regular registrant,
-- and its PAN is characters 3-12 of the GSTIN.
UPDATE "parties" SET "registration_type" = 'regular', "pan" = substring("gstin" from 3 for 10) WHERE "gstin" is not null;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_pan_check" CHECK ("parties"."pan" is null or "parties"."pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_gstin_registration_check" CHECK (("parties"."gstin" is not null) = ("parties"."registration_type" in ('regular', 'composition', 'sez')));--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_payment_terms_check" CHECK ("parties"."payment_terms_days" is null or "parties"."payment_terms_days" between 0 and 365);--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tds_vendor_only_check" CHECK ("parties"."default_tds_section" is null or "parties"."kind" = 'vendor');