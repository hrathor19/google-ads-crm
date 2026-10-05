-- Rollback: the single-audience column cannot represent a rule that
-- addresses two kinds of person, so the sets cannot be mapped back without
-- losing recipients. Reconfigure the routes on the Email page after this.
CREATE TYPE "CrmEmailAudience" AS ENUM ('ROLE', 'REQUESTER', 'ASSIGNEE', 'AD_SPECIALIST', 'FIXED');
ALTER TABLE "crm_email_routes"
  ADD COLUMN "audience" "CrmEmailAudience" NOT NULL DEFAULT 'ROLE',
  ADD COLUMN "audience_permission" TEXT,
  DROP COLUMN "to_roles",
  DROP COLUMN "cc_roles";
ALTER TABLE "crm_email_settings" DROP COLUMN "suppressed_emails";
