-- Per-request mail recipients.
--
-- Until now every mail recipient was global: a role, an address typed into
-- a route, or the settings-wide CC. All three apply to every request alike,
-- so there was no way to say "the sales POC for this LPU campaign belongs on
-- this trail and no other" — the only options were copying them on every
-- request or leaving them off entirely.
--
-- Addresses, not users: these people are copied on mail, not given access to
-- the app. The API still holds them to an allowed domain, because the mail
-- carries the assigned budget and the required CPL.
--
-- `added_by_email` is denormalised beside the relation so the row still says
-- who added them once that user is deleted, matching `crm_audit_logs`.
CREATE TABLE "crm_ad_request_recipients" (
  "id"             TEXT NOT NULL,
  "request_id"     TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "name"           TEXT,
  "added_by_id"    TEXT,
  "added_by_email" TEXT,
  "added_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_ad_request_recipients_pkey" PRIMARY KEY ("id")
);

-- One entry per person per request. The API lowercases before writing, so
-- this also stops the same address being added twice in different case.
CREATE UNIQUE INDEX "crm_ad_request_recipients_request_id_email_key"
  ON "crm_ad_request_recipients" ("request_id", "email");

CREATE INDEX "crm_ad_request_recipients_request_id_idx"
  ON "crm_ad_request_recipients" ("request_id");

ALTER TABLE "crm_ad_request_recipients"
  ADD CONSTRAINT "crm_ad_request_recipients_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not RESTRICT: deleting a user must not be blocked by a trail
-- they once added somebody to, and `added_by_email` preserves the answer.
ALTER TABLE "crm_ad_request_recipients"
  ADD CONSTRAINT "crm_ad_request_recipients_added_by_id_fkey"
  FOREIGN KEY ("added_by_id") REFERENCES "crm_users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
-- Who is on a request's mail trail is a recipient of budget and CPL figures,
-- so adding or removing one is an auditable act in its own right.
ALTER TYPE "CrmAuditAction" ADD VALUE 'REQUEST_RECIPIENTS_CHANGED';
