-- Rate windows for the same key never overlap, so exactly one rate is valid
-- on any supply date. Windows are inclusive on both ends; a null bound is
-- open. btree_gist lets the exclusion constraint compare text keys with =.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "gst_rate_mappings" ADD CONSTRAINT "gst_rate_mappings_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "kind" WITH =,
    "key" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );
--> statement-breakpoint
ALTER TABLE "organization_default_gst_rates" ADD CONSTRAINT "organization_default_gst_rates_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );
--> statement-breakpoint
-- HSN/SAC rates may overlap only when their conditions differ (e.g. price
-- thresholds); the lookup then returns every candidate for the user to pick.
ALTER TABLE "hsn_sac_rates" ADD CONSTRAINT "hsn_sac_rates_no_overlap"
  EXCLUDE USING gist (
    "code" WITH =,
    coalesce("condition", '') WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );
