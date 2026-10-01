-- CreateEnum
CREATE TYPE "CrmEmailAudience" AS ENUM ('ROLE', 'REQUESTER', 'ASSIGNEE', 'FIXED');

-- CreateTable
CREATE TABLE "crm_email_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "from_name" TEXT NOT NULL DEFAULT 'KollegeApply Ads CRM',
    "from_email" TEXT NOT NULL,
    "reply_to" TEXT,
    "subject_prefix" TEXT DEFAULT '[{{reference}}]',
    "global_cc" TEXT,
    "global_bcc" TEXT,
    "test_mode_recipient" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "crm_email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_email_routes" (
    "id" TEXT NOT NULL,
    "event" "CrmNotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "audience" "CrmEmailAudience" NOT NULL DEFAULT 'ROLE',
    "audience_permission" TEXT,
    "to_emails" TEXT,
    "cc" TEXT,
    "bcc" TEXT,
    "subject" TEXT NOT NULL,
    "intro" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_email_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_email_routes_event_key" ON "crm_email_routes"("event");

-- AddForeignKey
ALTER TABLE "crm_email_settings" ADD CONSTRAINT "crm_email_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

