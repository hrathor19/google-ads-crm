-- Move rows off the retired statuses onto their nearest equivalent in the
-- 13-step flow. Run as its own migration: the enum values were added in the
-- previous one and Postgres cannot use them until that transaction commits.
UPDATE "crm_ad_requests" SET "status" = 'RECHECK_REQUESTED' WHERE "status" = 'CHANGES_REQUESTED';
UPDATE "crm_ad_requests" SET "status" = 'REVIEW_APPROVED'   WHERE "status" = 'APPROVED';
UPDATE "crm_ad_requests" SET "status" = 'ADS_SUBMITTED'     WHERE "status" = 'IN_PROGRESS';
UPDATE "crm_ad_requests" SET "status" = 'UNDER_REVIEW'      WHERE "status" = 'READY';
