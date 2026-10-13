-- The address book the requirement form picks from.
--
-- The first shape of the mail trail was a text box: Operations typed the sales
-- POC's address into every request. That put the same person on ten campaigns
-- with their name spelled differently each time, and a typo silently meant a
-- mail nobody received. A directory makes the form a chooser instead.
--
-- Requests deliberately do NOT reference these rows. `crm_ad_request_recipients`
-- stores the name and address it was given, so removing somebody here cannot
-- rewrite who was copied on a campaign that already ran.
CREATE TABLE "crm_mail_contacts" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "email"            TEXT NOT NULL,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "created_by_id"    TEXT,
  "created_by_email" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "crm_mail_contacts_pkey" PRIMARY KEY ("id")
);

-- Addresses are lowercased on the way in, so this is a real "one row per
-- person" guarantee rather than one per spelling.
CREATE UNIQUE INDEX "crm_mail_contacts_email_key" ON "crm_mail_contacts" ("email");

-- The picker lists active people by name; this is the order it reads in.
CREATE INDEX "crm_mail_contacts_is_active_name_idx"
  ON "crm_mail_contacts" ("is_active", "name");

-- SET NULL, not RESTRICT: deleting a user must not be blocked by contacts they
-- once added, and `created_by_email` preserves the answer.
ALTER TABLE "crm_mail_contacts"
  ADD CONSTRAINT "crm_mail_contacts_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "crm_users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
-- The directory decides who receives mail carrying budget and CPL figures, so
-- every change to it is auditable in its own right.
ALTER TYPE "CrmAuditAction" ADD VALUE 'CONTACT_CREATED';
ALTER TYPE "CrmAuditAction" ADD VALUE 'CONTACT_UPDATED';
ALTER TYPE "CrmAuditAction" ADD VALUE 'CONTACT_DELETED';
ALTER TYPE "CrmAuditAction" ADD VALUE 'CONTACTS_IMPORTED';
