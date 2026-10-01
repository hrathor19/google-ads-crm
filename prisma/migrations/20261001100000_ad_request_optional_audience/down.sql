-- Rollback: require an audience again.
-- Backfill the NULLs first, or this fails.
UPDATE "crm_ad_requests" SET "target_audience" = '' WHERE "target_audience" IS NULL;
ALTER TABLE "crm_ad_requests" ALTER COLUMN "target_audience" SET NOT NULL;
