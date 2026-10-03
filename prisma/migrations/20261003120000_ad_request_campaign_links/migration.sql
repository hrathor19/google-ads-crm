-- A request runs many campaigns.
--
-- `crm_ad_requests.linked_campaign_id` held one hand-typed Google campaign id,
-- but a client routinely runs three or four campaigns under one brief. This
-- replaces it with a real relation, keyed on the internal `campaigns.id` so a
-- link survives a rename and cannot point at a campaign the sync has dropped.
--
-- The old column stays: it carries history, and reporting still falls back to
-- it for rows that have no link here.

-- CreateTable
CREATE TABLE "crm_ad_request_campaigns" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "linked_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_ad_request_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_ad_request_campaigns_request_id_idx" ON "crm_ad_request_campaigns"("request_id");

-- CreateIndex
CREATE INDEX "crm_ad_request_campaigns_campaign_id_idx" ON "crm_ad_request_campaigns"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ad_request_campaigns_request_id_campaign_id_key" ON "crm_ad_request_campaigns"("request_id", "campaign_id");

-- AddForeignKey
ALTER TABLE "crm_ad_request_campaigns" ADD CONSTRAINT "crm_ad_request_campaigns_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_campaigns" ADD CONSTRAINT "crm_ad_request_campaigns_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_campaigns" ADD CONSTRAINT "crm_ad_request_campaigns_linked_by_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: carry every resolvable linked_campaign_id across. A request whose
-- id matches no synced campaign keeps only the string, which the fallback in
-- `campaignsFor` still reads.
INSERT INTO "crm_ad_request_campaigns" ("id", "request_id", "campaign_id", "linked_by_id", "created_at")
SELECT
    md5(r."id" || ':' || c."id"::text),
    r."id",
    c."id",
    NULL,
    COALESCE(r."updated_at", CURRENT_TIMESTAMP)
FROM "crm_ad_requests" r
JOIN "campaigns" c
  ON r."linked_campaign_id" ~ '^[0-9]+$'
 AND c."campaign_id" = r."linked_campaign_id"::bigint
 AND (r."account_id" IS NULL OR c."account_id" = r."account_id")
ON CONFLICT DO NOTHING;
