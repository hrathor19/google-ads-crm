-- Rollback for 20261001120000_approval_flow_13_steps.
-- Run 20261001120100_approval_flow_backfill/down.sql FIRST, or rows will
-- still reference statuses this leaves in place.
DROP TABLE IF EXISTS "crm_ad_request_reviews";
ALTER TABLE "crm_ad_requests"
  DROP COLUMN IF EXISTS "account_manager_id",
  DROP COLUMN IF EXISTS "ad_specialist_id",
  DROP COLUMN IF EXISTS "version",
  DROP COLUMN IF EXISTS "review_round";
DROP TYPE IF EXISTS "ReviewOutcome";
-- The added AdRequestStatus values cannot be dropped in place; rebuilding the
-- type is destructive and left to a human.
