DROP TABLE IF EXISTS "crm_ad_request_recipients";

-- Rollback: Postgres cannot drop an enum value in place.
-- Recreating the type is destructive and is not worth automating; leave
-- 'REQUEST_RECIPIENTS_CHANGED' in place, or rebuild "CrmAuditAction" by hand.
