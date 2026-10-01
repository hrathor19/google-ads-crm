-- Rollback for 20261001090000_ad_request_activation_fields.
--
-- Prisma Migrate does not generate down migrations, so this is maintained by
-- hand to satisfy the "migrations must be reversible" requirement. Apply with
--   psql "$DATABASE_URL" -f down.sql
--
-- Destructive: dropping the columns discards whatever Ops has captured in
-- them. Take a backup first.

DROP TABLE IF EXISTS "crm_ad_request_lead_targets";

ALTER TABLE "crm_ad_requests"
  DROP COLUMN IF EXISTS "tracking_id",
  DROP COLUMN IF EXISTS "client_type",
  DROP COLUMN IF EXISTS "age_restriction",
  DROP COLUMN IF EXISTS "target_admission",
  DROP COLUMN IF EXISTS "application_deadline",
  DROP COLUMN IF EXISTS "focused_months",
  DROP COLUMN IF EXISTS "performance_parameter",
  DROP COLUMN IF EXISTS "reporting_panel",
  DROP COLUMN IF EXISTS "account_visibility",
  DROP COLUMN IF EXISTS "blocked_locations",
  DROP COLUMN IF EXISTS "required_leads",
  DROP COLUMN IF EXISTS "target_application",
  DROP COLUMN IF EXISTS "required_cpl",
  DROP COLUMN IF EXISTS "ad_url_kapplp_desktop",
  DROP COLUMN IF EXISTS "ad_url_kapplp_mobile",
  DROP COLUMN IF EXISTS "ad_url_kapplp_bing",
  DROP COLUMN IF EXISTS "ad_url_clientlp_desktop",
  DROP COLUMN IF EXISTS "ad_url_clientlp_mobile",
  DROP COLUMN IF EXISTS "ad_url_clientlp_bing";

DROP TYPE IF EXISTS "AdRequestClientType";
DROP TYPE IF EXISTS "AdRequestAgeRestriction";
