-- CreateEnum
CREATE TYPE "AdRequestClientType" AS ENUM ('CLIENT', 'GENERIC', 'NON_CLIENT', 'EXAM');

-- CreateEnum
CREATE TYPE "AdRequestAgeRestriction" AS ENUM ('OPEN', 'AGE_18_24');

-- AlterTable
ALTER TABLE "crm_ad_requests" ADD COLUMN     "account_visibility" TEXT,
ADD COLUMN     "ad_url_clientlp_bing" TEXT,
ADD COLUMN     "ad_url_clientlp_desktop" TEXT,
ADD COLUMN     "ad_url_clientlp_mobile" TEXT,
ADD COLUMN     "ad_url_kapplp_bing" TEXT,
ADD COLUMN     "ad_url_kapplp_desktop" TEXT,
ADD COLUMN     "ad_url_kapplp_mobile" TEXT,
ADD COLUMN     "age_restriction" "AdRequestAgeRestriction" DEFAULT 'OPEN',
ADD COLUMN     "application_deadline" TEXT,
ADD COLUMN     "blocked_locations" TEXT,
ADD COLUMN     "client_type" "AdRequestClientType",
ADD COLUMN     "focused_months" TEXT,
ADD COLUMN     "performance_parameter" TEXT,
ADD COLUMN     "reporting_panel" TEXT,
ADD COLUMN     "required_cpl" DECIMAL(14,2),
ADD COLUMN     "required_leads" INTEGER,
ADD COLUMN     "target_admission" TEXT,
ADD COLUMN     "target_application" INTEGER,
ADD COLUMN     "tracking_id" TEXT;

-- CreateTable
CREATE TABLE "crm_ad_request_lead_targets" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "leads" INTEGER NOT NULL,

    CONSTRAINT "crm_ad_request_lead_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_ad_request_lead_targets_request_id_idx" ON "crm_ad_request_lead_targets"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ad_request_lead_targets_request_id_month_key" ON "crm_ad_request_lead_targets"("request_id", "month");

-- AddForeignKey
ALTER TABLE "crm_ad_request_lead_targets" ADD CONSTRAINT "crm_ad_request_lead_targets_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

