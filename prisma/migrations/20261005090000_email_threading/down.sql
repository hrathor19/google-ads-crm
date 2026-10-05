ALTER TABLE "crm_email_settings"
  DROP COLUMN IF EXISTS "thread_per_request",
  DROP COLUMN IF EXISTS "thread_subject";
