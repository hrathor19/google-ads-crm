-- CreateEnum
CREATE TYPE "AdRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'READY', 'LIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampaignObjective" AS ENUM ('LEAD_GENERATION', 'WEBSITE_TRAFFIC', 'BRAND_AWARENESS', 'APP_PROMOTION', 'SALES', 'LOCAL_VISITS');

-- CreateEnum
CREATE TYPE "AdRequestEventType" AS ENUM ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'ASSIGNED', 'STATUS_CHANGED', 'COMMENT', 'AD_COPY_GENERATED', 'LANDING_SCORED', 'CAMPAIGN_LINKED');

-- CreateEnum
CREATE TYPE "CrmNotificationType" AS ENUM ('REQUEST_SUBMITTED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_CHANGES_REQUESTED', 'REQUEST_ASSIGNED', 'REQUEST_COMMENTED', 'REQUEST_STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "CrmAuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'USER_CREATED', 'USER_UPDATED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_CLONED', 'ROLE_DELETED', 'PERMISSION_CHANGED', 'ACCOUNT_SCOPE_CHANGED', 'REQUEST_CREATED', 'REQUEST_SUBMITTED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_CHANGES_REQUESTED', 'REQUEST_STATUS_CHANGED', 'AI_COPY_GENERATED', 'LANDING_PAGE_SCORED', 'DATA_EXPORTED', 'SYNC_TRIGGERED', 'INTEGRATION_TESTED');

-- CreateTable
CREATE TABLE "crm_roles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "all_accounts" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_role_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crm_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_role_accounts" (
    "role_id" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,

    CONSTRAINT "crm_role_accounts_pkey" PRIMARY KEY ("role_id","account_id")
);

-- CreateTable
CREATE TABLE "crm_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "all_accounts" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_user_accounts" (
    "user_id" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,

    CONSTRAINT "crm_user_accounts_pkey" PRIMARY KEY ("user_id","account_id")
);

-- CreateTable
CREATE TABLE "crm_ad_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "AdRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "objective" "CampaignObjective" NOT NULL DEFAULT 'LEAD_GENERATION',
    "title" TEXT NOT NULL,
    "account_id" INTEGER,
    "product_service" TEXT NOT NULL,
    "target_audience" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "budget" DECIMAL(14,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "landing_page_url" TEXT NOT NULL,
    "usps" TEXT,
    "keywords" TEXT,
    "notes" TEXT,
    "linked_campaign_id" TEXT,
    "decision_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "assigned_to_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_ad_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ad_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "type" "AdRequestEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "from_status" "AdRequestStatus",
    "to_status" "AdRequestStatus",
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_ad_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ad_request_attachments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_ad_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ad_copy_versions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "tone" TEXT NOT NULL,
    "headlines" JSONB NOT NULL,
    "descriptions" JSONB NOT NULL,
    "validation" JSONB,
    "backend" TEXT NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_ad_copy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_landing_scores" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "url" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "page_type" TEXT NOT NULL,
    "passed" INTEGER NOT NULL,
    "max_points" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "categories" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "tracking" JSONB,
    "links" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_landing_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "CrmNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "request_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "action" "CrmAuditAction" NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_roles_slug_key" ON "crm_roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "crm_roles_name_key" ON "crm_roles"("name");

-- CreateIndex
CREATE INDEX "crm_role_permissions_role_id_idx" ON "crm_role_permissions"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_role_permissions_role_feature" ON "crm_role_permissions"("role_id", "feature");

-- CreateIndex
CREATE INDEX "crm_role_accounts_account_id_idx" ON "crm_role_accounts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_users_email_key" ON "crm_users"("email");

-- CreateIndex
CREATE INDEX "crm_users_role_id_idx" ON "crm_users"("role_id");

-- CreateIndex
CREATE INDEX "crm_user_accounts_account_id_idx" ON "crm_user_accounts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ad_requests_reference_key" ON "crm_ad_requests"("reference");

-- CreateIndex
CREATE INDEX "crm_ad_requests_status_idx" ON "crm_ad_requests"("status");

-- CreateIndex
CREATE INDEX "crm_ad_requests_account_id_idx" ON "crm_ad_requests"("account_id");

-- CreateIndex
CREATE INDEX "crm_ad_requests_created_by_id_idx" ON "crm_ad_requests"("created_by_id");

-- CreateIndex
CREATE INDEX "crm_ad_requests_assigned_to_id_idx" ON "crm_ad_requests"("assigned_to_id");

-- CreateIndex
CREATE INDEX "crm_ad_requests_created_at_idx" ON "crm_ad_requests"("created_at");

-- CreateIndex
CREATE INDEX "crm_ad_request_events_request_id_created_at_idx" ON "crm_ad_request_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_ad_request_attachments_request_id_idx" ON "crm_ad_request_attachments"("request_id");

-- CreateIndex
CREATE INDEX "crm_ad_copy_versions_request_id_idx" ON "crm_ad_copy_versions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ad_copy_versions_request_id_version_key" ON "crm_ad_copy_versions"("request_id", "version");

-- CreateIndex
CREATE INDEX "crm_landing_scores_request_id_created_at_idx" ON "crm_landing_scores"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_notifications_user_id_read_at_idx" ON "crm_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "crm_notifications_user_id_created_at_idx" ON "crm_notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_audit_logs_actor_id_idx" ON "crm_audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "crm_audit_logs_action_idx" ON "crm_audit_logs"("action");

-- CreateIndex
CREATE INDEX "crm_audit_logs_created_at_idx" ON "crm_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "crm_role_permissions" ADD CONSTRAINT "crm_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_role_accounts" ADD CONSTRAINT "crm_role_accounts_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_role_accounts" ADD CONSTRAINT "crm_role_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_users" ADD CONSTRAINT "crm_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_user_accounts" ADD CONSTRAINT "crm_user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "crm_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_user_accounts" ADD CONSTRAINT "crm_user_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_requests" ADD CONSTRAINT "crm_ad_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "crm_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_requests" ADD CONSTRAINT "crm_ad_requests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_requests" ADD CONSTRAINT "crm_ad_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_events" ADD CONSTRAINT "crm_ad_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_events" ADD CONSTRAINT "crm_ad_request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_request_attachments" ADD CONSTRAINT "crm_ad_request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_copy_versions" ADD CONSTRAINT "crm_ad_copy_versions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ad_copy_versions" ADD CONSTRAINT "crm_ad_copy_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "crm_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_landing_scores" ADD CONSTRAINT "crm_landing_scores_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_landing_scores" ADD CONSTRAINT "crm_landing_scores_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "crm_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "crm_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crm_ad_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_audit_logs" ADD CONSTRAINT "crm_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

