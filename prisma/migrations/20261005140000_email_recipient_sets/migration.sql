-- To and CC become sets of people, not one audience.
--
-- A step can legitimately address two kinds of person at once — "the
-- Operations person who raised it and the Ad Specialist assigned to it" —
-- which a single `audience` column could not express, so those rules were
-- being configured as fixed addresses that go stale the moment somebody
-- changes role.

CREATE TYPE "CrmEmailRecipient" AS ENUM (
  'MANAGER', 'REQUESTER', 'AD_SPECIALIST', 'OPS_TEAM', 'ADS_TEAM'
);

ALTER TABLE "crm_email_routes"
  ADD COLUMN "to_roles" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "cc_roles" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "crm_email_settings"
  ADD COLUMN "suppressed_emails" TEXT;

-- Carry the old single audience across, so nothing silently loses its
-- recipients between deploying this and reconfiguring.
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['REQUESTER']     WHERE "audience" = 'REQUESTER';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['AD_SPECIALIST'] WHERE "audience" IN ('AD_SPECIALIST', 'ASSIGNEE');
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['MANAGER']       WHERE "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:ASSIGN';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['OPS_TEAM']      WHERE "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:CREATE';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['ADS_TEAM']      WHERE "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:BUILD';

-- The agreed routing. Fixed addresses already typed into a rule are left
-- alone: roles are additive, so an operator's own CC survives this.
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['MANAGER'],                 "cc_roles" = '{}'                 WHERE "event" = 'REQUEST_SUBMITTED';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['REQUESTER','AD_SPECIALIST'], "cc_roles" = ARRAY['MANAGER']   WHERE "event" = 'REQUEST_SPECIALIST_ASSIGNED';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['MANAGER'],                 "cc_roles" = ARRAY['REQUESTER']   WHERE "event" = 'REQUEST_ADS_SUBMITTED';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['REQUESTER','AD_SPECIALIST'], "cc_roles" = ARRAY['MANAGER']   WHERE "event" = 'REQUEST_APPROVED';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['MANAGER'],                 "cc_roles" = ARRAY['AD_SPECIALIST','REQUESTER'] WHERE "event" = 'REQUEST_LIVE';
-- A recheck is work for the Specialist; the reviewer and the Manager watch.
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['AD_SPECIALIST'],           "cc_roles" = ARRAY['REQUESTER','MANAGER'] WHERE "event" = 'REQUEST_CHANGES_REQUESTED';
-- A rejection ends it: the person who raised it needs to know, and whoever
-- was already building it should stop.
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['REQUESTER'],               "cc_roles" = ARRAY['MANAGER','AD_SPECIALIST'] WHERE "event" = 'REQUEST_REJECTED';
UPDATE "crm_email_routes" SET "to_roles" = ARRAY['REQUESTER','AD_SPECIALIST'] WHERE "event" = 'REQUEST_COMMENTED';

ALTER TABLE "crm_email_routes"
  DROP COLUMN "audience",
  DROP COLUMN "audience_permission";

DROP TYPE IF EXISTS "CrmEmailAudience";
