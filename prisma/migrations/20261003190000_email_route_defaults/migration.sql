-- Re-point the routes that nobody has edited.
--
-- `getEmailRoutes()` creates a row per event from the defaults and then never
-- touches it again, which is right — it must not overwrite a Super Admin's
-- choices. But the rows created before the 13-step flow existed carry the old
-- generic defaults: "review approved" went to everyone holding
-- AD_REQUESTS:EDIT rather than to the Ad Specialist who is waiting for it.
--
-- A row is treated as untouched only when audience, permission AND subject
-- all still equal the old default exactly. Anything a human has changed keeps
-- its value, including a subject edited back to the same words — the cost of
-- that is a route left as the operator set it, which is the safe direction.

UPDATE "crm_email_routes"
   SET "audience" = 'ROLE', "audience_permission" = 'AD_REQUESTS:ASSIGN',
       "subject" = '{{title}} — new ad requirement raised'
 WHERE "event" = 'REQUEST_SUBMITTED'
   AND "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:APPROVE'
   AND "subject" = '{{title}} — new ad requirement awaiting approval';

UPDATE "crm_email_routes"
   SET "audience" = 'AD_SPECIALIST', "audience_permission" = NULL,
       "subject" = '{{title}} — review approved'
 WHERE "event" = 'REQUEST_APPROVED'
   AND "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:EDIT'
   AND "subject" = '{{title}} — approved, ready to build';

UPDATE "crm_email_routes"
   SET "audience" = 'AD_SPECIALIST', "audience_permission" = NULL,
       "subject" = '{{title}} — recheck requested'
 WHERE "event" = 'REQUEST_CHANGES_REQUESTED'
   AND "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:CREATE'
   AND "subject" = '{{title}} — changes requested';

UPDATE "crm_email_routes"
   SET "audience" = 'REQUESTER', "audience_permission" = NULL
 WHERE "event" = 'REQUEST_REJECTED'
   AND "audience" = 'ROLE' AND "audience_permission" = 'AD_REQUESTS:CREATE';

-- Events the flow no longer fires a mail for. Their rows would render on the
-- settings page as a bare enum name with no description and no effect.
DELETE FROM "crm_email_routes"
 WHERE "event" IN ('REQUEST_ASSIGNED', 'REQUEST_STATUS_CHANGED');
