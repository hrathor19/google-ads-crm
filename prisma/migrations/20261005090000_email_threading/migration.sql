-- One mail trail per request.
--
-- Every notification carried its own subject — "budget and CPL approved",
-- "keywords and ad copy ready for review" — so Gmail filed eight separate
-- conversations for one client. The References header was already right;
-- Gmail groups by normalised subject first and only then by headers, so a
-- changing subject splits the trail whatever the headers say.
--
-- On by default, because a per-step subject was never the intent: the step
-- belongs in the body, where it does not break threading.
ALTER TABLE "crm_email_settings"
  ADD COLUMN "thread_per_request" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "thread_subject" TEXT DEFAULT '{{title}}';
