-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('APPROVED', 'RECHECK_REQUESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdRequestStatus" ADD VALUE 'AWAITING_AM_ASSIGNMENT';
ALTER TYPE "AdRequestStatus" ADD VALUE 'AM_ASSIGNED';
ALTER TYPE "AdRequestStatus" ADD VALUE 'AWAITING_AD_SUBMISSION';
ALTER TYPE "AdRequestStatus" ADD VALUE 'ADS_SUBMITTED';
ALTER TYPE "AdRequestStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "AdRequestStatus" ADD VALUE 'RECHECK_REQUESTED';
ALTER TYPE "AdRequestStatus" ADD VALUE 'REVIEW_APPROVED';
ALTER TYPE "AdRequestStatus" ADD VALUE 'BUDGET_APPROVED';
ALTER TYPE "AdRequestStatus" ADD VALUE 'ACCOUNT_ASSIGNED';

-- AlterTable
ALTER TABLE "crm_ad_requests" ADD COLUMN     "account_manager_id" TEXT,
ADD COLUMN     "ad_specialist_id" TEXT,
ADD COLUMN     "review_round" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "crm_ad_request_reviews" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "remarks" TEXT,
    "reviewer_id" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ad_copy_version_id" TEXT,

    CONSTRAINT "crm_ad_request_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_ad_request_reviews_request_id_idx" ON "crm_ad_request_reviews"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ad_request_reviews_request_id_round_key" ON "crm_ad_request_reviews"("request_id", "round");

-- AddForeignKey
ALTER TABLE "crm_ad_requests" ADD CONSTRAINT "crm_ad_requests_account_manager_id_fkey" FOREIGN KEY ("account_manager_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_requests" ADD CONSTRAINT "crm_ad_requests_ad_specialist_id_fkey" FOREIGN KEY ("ad_specialist_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_reviews" ADD CONSTRAINT "crm_ad_request_reviews_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_reviews" ADD CONSTRAINT "crm_ad_request_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "crm_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Map the retired statuses onto the new pipeline. Separate from the ALTER
-- TYPE above because Postgres will not let a value added in this transaction
-- be used until it commits; Prisma runs each migration file in its own
-- transaction, so this runs in the next one.
