-- ============================================================================
--  Ads CRM — database upgrade for the per-request mail trail + contacts
--
--  Brings a server that is on the "Email CC management" release up to the
--  release that adds the contact directory and the per-request CC list.
--
--  Safe to run more than once. Every statement is guarded, so a second run is
--  a no-op rather than an error — which also means a run that dies halfway can
--  simply be run again.
--
--  Purely additive: it creates two new tables and adds five values to an enum.
--  No existing table, column or row is read, altered or deleted.
--
--  Needs PostgreSQL 12 or newer (ALTER TYPE ... ADD VALUE inside a
--  transaction). Check with:  SHOW server_version;
--
--  Run with:  psql "$DATABASE_URL" -f upgrade-mail-contacts.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
--  1. Audit actions
--
--  Added before the tables, because PostgreSQL will not let a value added to
--  an enum be USED in the same transaction that added it. Nothing here uses
--  them, but keeping them first means that stays true if this file grows.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TYPE "CrmAuditAction" ADD VALUE IF NOT EXISTS 'REQUEST_RECIPIENTS_CHANGED';
ALTER TYPE "CrmAuditAction" ADD VALUE IF NOT EXISTS 'CONTACT_CREATED';
ALTER TYPE "CrmAuditAction" ADD VALUE IF NOT EXISTS 'CONTACT_UPDATED';
ALTER TYPE "CrmAuditAction" ADD VALUE IF NOT EXISTS 'CONTACT_DELETED';
ALTER TYPE "CrmAuditAction" ADD VALUE IF NOT EXISTS 'CONTACTS_IMPORTED';

-- ─────────────────────────────────────────────────────────────────────────
--  2. The people copied on ONE request's mail
--
--  Every other recipient rule is global — a role, an address on a route, or
--  the settings-wide CC — and applies to every request alike. This is the
--  list that belongs to a single request.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_ad_request_recipients" (
  "id"             TEXT NOT NULL,
  "request_id"     TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "name"           TEXT,
  "added_by_id"    TEXT,
  "added_by_email" TEXT,
  "added_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_ad_request_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_ad_request_recipients_request_id_email_key"
  ON "crm_ad_request_recipients" ("request_id", "email");

CREATE INDEX IF NOT EXISTS "crm_ad_request_recipients_request_id_idx"
  ON "crm_ad_request_recipients" ("request_id");

-- ─────────────────────────────────────────────────────────────────────────
--  3. The address book the requirement form picks from
--
--  Requests do NOT reference these rows: a trail stores the name and address
--  it was given, so tidying this list cannot rewrite who was copied on a
--  campaign that already ran.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_mail_contacts" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "crm_mail_contacts_email_key"
  ON "crm_mail_contacts" ("email");

CREATE INDEX IF NOT EXISTS "crm_mail_contacts_is_active_name_idx"
  ON "crm_mail_contacts" ("is_active", "name");

-- ─────────────────────────────────────────────────────────────────────────
--  4. Foreign keys
--
--  ADD CONSTRAINT has no IF NOT EXISTS, so each one is guarded by hand.
--
--  The request link is CASCADE: deleting a request takes its trail with it.
--  The user links are SET NULL, so deleting a user is never blocked by a
--  contact they added — `*_by_email` keeps the answer to "who did this".
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'crm_ad_request_recipients_request_id_fkey') THEN
    ALTER TABLE "crm_ad_request_recipients"
      ADD CONSTRAINT "crm_ad_request_recipients_request_id_fkey"
      FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'crm_ad_request_recipients_added_by_id_fkey') THEN
    ALTER TABLE "crm_ad_request_recipients"
      ADD CONSTRAINT "crm_ad_request_recipients_added_by_id_fkey"
      FOREIGN KEY ("added_by_id") REFERENCES "crm_users" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'crm_mail_contacts_created_by_id_fkey') THEN
    ALTER TABLE "crm_mail_contacts"
      ADD CONSTRAINT "crm_mail_contacts_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "crm_users" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
--  5. Tell Prisma these two migrations are done
--
--  Without this, the next `prisma migrate deploy` tries to run them again and
--  fails on "table already exists". The checksums are the SHA-256 of each
--  migration.sql in the repository, which is what Prisma compares against.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  '02da71c59e0e4bea9f364c086a7259cd3d3e5d2d9221099007f70a006a5d3c9d',
  now(), '20261013120000_ad_request_recipients', now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20261013120000_ad_request_recipients'
    AND rolled_back_at IS NULL
);

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  '094329dc91c7403abb4171fb061e5170b624423cd1a765df24938d16162afd45',
  now(), '20261013150000_mail_contacts', now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20261013150000_mail_contacts'
    AND rolled_back_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────
--  6. What it looks like when it worked
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'tables' AS check, count(*)::text || ' of 2' AS result
  FROM pg_tables WHERE schemaname = 'public'
   AND tablename IN ('crm_mail_contacts', 'crm_ad_request_recipients')
UNION ALL
SELECT 'audit actions', count(*)::text || ' of 5'
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'CrmAuditAction'
   AND e.enumlabel IN ('REQUEST_RECIPIENTS_CHANGED', 'CONTACT_CREATED',
                       'CONTACT_UPDATED', 'CONTACT_DELETED', 'CONTACTS_IMPORTED')
UNION ALL
SELECT 'foreign keys', count(*)::text || ' of 3'
  FROM pg_constraint
 WHERE conname IN ('crm_ad_request_recipients_request_id_fkey',
                   'crm_ad_request_recipients_added_by_id_fkey',
                   'crm_mail_contacts_created_by_id_fkey')
UNION ALL
SELECT 'migrations recorded', count(*)::text || ' of 2'
  FROM "_prisma_migrations"
 WHERE migration_name IN ('20261013120000_ad_request_recipients',
                          '20261013150000_mail_contacts')
   AND rolled_back_at IS NULL;
