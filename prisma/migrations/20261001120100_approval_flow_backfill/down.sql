-- Rollback: put the rows back on the retired statuses.
UPDATE "crm_ad_requests" SET "status" = 'CHANGES_REQUESTED' WHERE "status" = 'RECHECK_REQUESTED';
UPDATE "crm_ad_requests" SET "status" = 'APPROVED'          WHERE "status" = 'REVIEW_APPROVED';
UPDATE "crm_ad_requests" SET "status" = 'IN_PROGRESS'       WHERE "status" = 'ADS_SUBMITTED';
UPDATE "crm_ad_requests" SET "status" = 'READY'             WHERE "status" = 'UNDER_REVIEW';
