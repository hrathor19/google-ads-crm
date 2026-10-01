-- Rollback: make the column required again.
-- Will fail if any row has a NULL budget; set one first.
ALTER TABLE "crm_ad_requests" ALTER COLUMN "budget" SET NOT NULL;
