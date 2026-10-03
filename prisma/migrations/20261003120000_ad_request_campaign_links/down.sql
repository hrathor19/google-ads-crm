-- Rollback: the links are derived from `linked_campaign_id` for rows that
-- predate this, but any link added since exists only here and is lost.
DROP TABLE IF EXISTS "crm_ad_request_campaigns";
