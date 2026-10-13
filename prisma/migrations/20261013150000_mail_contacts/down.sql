DROP TABLE IF EXISTS "crm_mail_contacts";

-- Rollback: Postgres cannot drop an enum value in place.
-- Recreating the type is destructive and is not worth automating; leave the
-- CONTACT_* values in place, or rebuild "CrmAuditAction" by hand.
