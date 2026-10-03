-- The 13-step flow's own mail moments.
--
-- The existing values are generic ("approved", "status changed") and predate
-- the flow, so routing a mail to the Ad Specialist on assignment meant
-- reusing a value that means something else. Each step people actually asked
-- to be mailed about now has its own event, which is also what makes them
-- separately switchable on the Email page.
ALTER TYPE "CrmNotificationType" ADD VALUE 'REQUEST_SPECIALIST_ASSIGNED';
ALTER TYPE "CrmNotificationType" ADD VALUE 'REQUEST_BUDGET_APPROVED';
ALTER TYPE "CrmNotificationType" ADD VALUE 'REQUEST_ADS_SUBMITTED';
ALTER TYPE "CrmNotificationType" ADD VALUE 'REQUEST_LIVE';

-- "Mail the ad person who was selected, not every ad person." ROLE resolves
-- to everyone holding a permission, which is exactly the wrong thing here.
ALTER TYPE "CrmEmailAudience" ADD VALUE 'AD_SPECIALIST';
