-- CreateTable
CREATE TABLE "account_budgets" (
    "account_id" INTEGER NOT NULL,
    "period" VARCHAR(8) NOT NULL,
    "period_start" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "set_by" VARCHAR(160),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_account_budgets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_weekly_budgets" (
    "account_id" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "set_by" VARCHAR(160),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_account_weekly_budgets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "customer_id" VARCHAR(20) NOT NULL,
    "descriptive_name" VARCHAR(255),
    "currency_code" VARCHAR(8),
    "time_zone" VARCHAR(64),
    "status" VARCHAR(32),
    "is_manager" BOOLEAN NOT NULL,
    "manager_customer_id" VARCHAR(20),
    "test_account" BOOLEAN,
    "auto_tagging_enabled" BOOLEAN,
    "is_syncable" BOOLEAN NOT NULL,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_copy_generations" (
    "actor" VARCHAR(320),
    "campus" VARCHAR(255) NOT NULL,
    "account_id" INTEGER,
    "campaign_id" INTEGER,
    "final_url" TEXT,
    "url_source" VARCHAR(48),
    "url_confidence" DECIMAL(5,4),
    "backend" VARCHAR(16),
    "historical_features_used" JSONB,
    "keyword_snapshot" JSONB,
    "keyword_edits" JSONB,
    "generated_assets" JSONB,
    "scores" JSONB,
    "reasoning" JSONB,
    "approval_status" VARCHAR(16) NOT NULL,
    "submitted_at" TIMESTAMP(6),
    "reviewed_at" TIMESTAMP(6),
    "reviewer_name" VARCHAR(160),
    "review_note" TEXT,
    "overrides" JSONB,
    "approval_token" VARCHAR(64),
    "ad_manager" VARCHAR(160),
    "owner_user_id" INTEGER,
    "submitter_user_id" INTEGER,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_ad_copy_generations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_group_snapshots" (
    "ad_group_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "status" VARCHAR(32),
    "cpc_bid_micros" BIGINT,
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_ad_group_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_groups" (
    "account_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "ad_group_id" BIGINT NOT NULL,
    "name" VARCHAR(512),
    "status" VARCHAR(32),
    "type" VARCHAR(64),
    "cpc_bid_micros" BIGINT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_ad_groups" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_snapshots" (
    "ad_id" INTEGER NOT NULL,
    "ad_group_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "status" VARCHAR(32),
    "approval_status" VARCHAR(32),
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_ad_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "account_id" INTEGER NOT NULL,
    "ad_group_id" INTEGER NOT NULL,
    "ad_id" BIGINT NOT NULL,
    "type" VARCHAR(64),
    "status" VARCHAR(32),
    "approval_status" VARCHAR(32),
    "final_urls" TEXT,
    "headlines" TEXT,
    "descriptions" TEXT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_ads" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alembic_version" (
    "version_num" VARCHAR(32) NOT NULL,

    CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num")
);

-- CreateTable
CREATE TABLE "alerts" (
    "account_id" INTEGER,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" INTEGER,
    "entity_name" VARCHAR(512),
    "alert_type" VARCHAR(48) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "suggested_action" TEXT,
    "metric_value" DECIMAL(18,4),
    "threshold_value" DECIMAL(18,4),
    "dedupe_key" VARCHAR(255) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "details" JSONB,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_alerts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "provider" VARCHAR(32) NOT NULL,
    "account_id" INTEGER,
    "client_id" VARCHAR(255),
    "refresh_token_encrypted" TEXT,
    "scopes" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_api_tokens" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_events" (
    "generation_id" INTEGER NOT NULL,
    "event" VARCHAR(24) NOT NULL,
    "actor" VARCHAR(160),
    "note" TEXT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_approval_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "actor" VARCHAR(320),
    "role" VARCHAR(32),
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "status_code" INTEGER,
    "duration_ms" INTEGER,
    "client_ip" VARCHAR(64),
    "detail" TEXT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_snapshots" (
    "budget_id" INTEGER NOT NULL,
    "amount_micros" BIGINT,
    "spend_micros" BIGINT,
    "utilization" DECIMAL(10,4),
    "delivery_method" VARCHAR(32),
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,

    CONSTRAINT "pk_budget_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "account_id" INTEGER NOT NULL,
    "budget_id" BIGINT NOT NULL,
    "name" VARCHAR(512),
    "amount_micros" BIGINT,
    "delivery_method" VARCHAR(32),
    "period" VARCHAR(32),
    "explicitly_shared" BOOLEAN,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_budgets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_device_snapshots" (
    "campaign_id" INTEGER NOT NULL,
    "device" VARCHAR(32) NOT NULL,
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_campaign_device_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_geo_snapshots" (
    "campaign_id" INTEGER NOT NULL,
    "country_criterion_id" BIGINT,
    "location_name" VARCHAR(255),
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_campaign_geo_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_snapshots" (
    "campaign_id" INTEGER NOT NULL,
    "status" VARCHAR(32),
    "budget_micros" BIGINT,
    "bidding_strategy_type" VARCHAR(64),
    "optimization_score" DOUBLE PRECISION,
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_campaign_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "account_id" INTEGER NOT NULL,
    "campaign_id" BIGINT NOT NULL,
    "name" VARCHAR(512),
    "status" VARCHAR(32),
    "serving_status" VARCHAR(32),
    "advertising_channel_type" VARCHAR(32),
    "advertising_channel_sub_type" VARCHAR(64),
    "bidding_strategy_type" VARCHAR(64),
    "networks" VARCHAR(255),
    "start_date" DATE,
    "end_date" DATE,
    "optimization_score" DOUBLE PRECISION,
    "budget_id" BIGINT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_campaigns" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_snapshots" (
    "keyword_id" INTEGER NOT NULL,
    "ad_group_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "match_type" VARCHAR(32),
    "status" VARCHAR(32),
    "quality_score" INTEGER,
    "expected_ctr" VARCHAR(32),
    "landing_page_experience" VARCHAR(32),
    "ad_relevance" VARCHAR(32),
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_keyword_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keywords" (
    "account_id" INTEGER NOT NULL,
    "ad_group_id" INTEGER NOT NULL,
    "criterion_id" BIGINT NOT NULL,
    "text" VARCHAR(1024),
    "match_type" VARCHAR(32),
    "status" VARCHAR(32),
    "cpc_bid_micros" BIGINT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_keywords" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "resource_name" VARCHAR(512) NOT NULL,
    "recommendation_type" VARCHAR(64),
    "campaign_id" INTEGER,
    "campaign_google_id" BIGINT,
    "impact_base_cost_micros" BIGINT,
    "impact_potential_cost_micros" BIGINT,
    "impact_base_clicks" DOUBLE PRECISION,
    "impact_potential_clicks" DOUBLE PRECISION,
    "impact_base_conversions" DOUBLE PRECISION,
    "impact_potential_conversions" DOUBLE PRECISION,
    "dismissed" BOOLEAN,
    "details" TEXT,
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,

    CONSTRAINT "pk_recommendations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorecard_snapshots" (
    "campus" VARCHAR(255) NOT NULL,
    "account_id" INTEGER,
    "generation_id" INTEGER,
    "achieved_leads" DECIMAL(16,2),
    "achieved_cost" DECIMAL(18,2),
    "achieved_clicks" INTEGER,
    "implementation_pct" INTEGER,
    "expected_leads" DECIMAL(16,2),
    "target_leads" INTEGER,
    "payload" JSONB,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_scorecard_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_term_snapshots" (
    "search_term_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "ad_group_id" INTEGER NOT NULL,
    "id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "sync_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "sync_log_id" INTEGER,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "interactions" BIGINT NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "ctr" DECIMAL(12,6),
    "average_cpc_micros" BIGINT,
    "average_cpm_micros" BIGINT,
    "conversions" DECIMAL(16,4) NOT NULL,
    "conversions_value" DECIMAL(18,4) NOT NULL,
    "all_conversions" DECIMAL(16,4) NOT NULL,
    "video_views" BIGINT NOT NULL,

    CONSTRAINT "pk_search_term_snapshots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_terms" (
    "account_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "ad_group_id" INTEGER NOT NULL,
    "query" VARCHAR(1024) NOT NULL,
    "match_type" VARCHAR(32),
    "search_term_targeting_status" VARCHAR(32),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_search_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "sync_type" VARCHAR(16) NOT NULL,
    "entity" VARCHAR(48) NOT NULL,
    "customer_id" VARCHAR(20),
    "status" VARCHAR(16) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" BIGINT,
    "rows_inserted" INTEGER NOT NULL,
    "rows_updated" INTEGER NOT NULL,
    "rows_failed" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "error_message" TEXT,
    "details" JSONB,
    "id" SERIAL NOT NULL,

    CONSTRAINT "pk_sync_logs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "user_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_user_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "email" VARCHAR(320) NOT NULL,
    "full_name" VARCHAR(255),
    "role" VARCHAR(32) NOT NULL,
    "hashed_password" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL,
    "google_sub" VARCHAR(255),
    "picture" VARCHAR(1024),
    "last_login_at" TIMESTAMPTZ(6),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_users" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_budget_uq" ON "account_budgets"("account_id" ASC, "period" ASC, "period_start" ASC);

-- CreateIndex
CREATE INDEX "ix_account_budgets_account_id" ON "account_budgets"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_account_budgets_period_start" ON "account_budgets"("period_start" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "account_weekly_budget_uq" ON "account_weekly_budgets"("account_id" ASC, "week_start" ASC);

-- CreateIndex
CREATE INDEX "ix_account_weekly_budgets_account_id" ON "account_weekly_budgets"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_account_weekly_budgets_week_start" ON "account_weekly_budgets"("week_start" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ix_accounts_customer_id" ON "accounts"("customer_id" ASC);

-- CreateIndex
CREATE INDEX "ix_accounts_manager_customer_id" ON "accounts"("manager_customer_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_account_created" ON "ad_copy_generations"("account_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_account_id" ON "ad_copy_generations"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_actor" ON "ad_copy_generations"("actor" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_ad_manager" ON "ad_copy_generations"("ad_manager" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_approval_status" ON "ad_copy_generations"("approval_status" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_approval_token" ON "ad_copy_generations"("approval_token" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_campaign_id" ON "ad_copy_generations"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_campus" ON "ad_copy_generations"("campus" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_campus_created" ON "ad_copy_generations"("campus" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_owner_user_id" ON "ad_copy_generations"("owner_user_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_copy_generations_submitter_user_id" ON "ad_copy_generations"("submitter_user_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_group_snapshots_account_id" ON "ad_group_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_group_snapshots_ad_group_id" ON "ad_group_snapshots"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_group_snapshots_campaign_id" ON "ad_group_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_group_snapshots_snapshot_date" ON "ad_group_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_group_snapshots_sync_time" ON "ad_group_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ad_groups_campaign_adgroup" ON "ad_groups"("campaign_id" ASC, "ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_groups_account_id" ON "ad_groups"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_groups_ad_group_id" ON "ad_groups"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_groups_campaign_id" ON "ad_groups"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_account_date" ON "ad_snapshots"("account_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_account_id" ON "ad_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_ad_group_id" ON "ad_snapshots"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_ad_id" ON "ad_snapshots"("ad_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_campaign_id" ON "ad_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_snapshot_date" ON "ad_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_ad_snapshots_sync_time" ON "ad_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ads_adgroup_ad" ON "ads"("ad_group_id" ASC, "ad_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ads_account_id" ON "ads"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ads_ad_group_id" ON "ads"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_ads_ad_id" ON "ads"("ad_id" ASC);

-- CreateIndex
CREATE INDEX "ix_alerts_account_id" ON "alerts"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_alerts_alert_type" ON "alerts"("alert_type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ix_alerts_dedupe_key" ON "alerts"("dedupe_key" ASC);

-- CreateIndex
CREATE INDEX "ix_alerts_entity_id" ON "alerts"("entity_id" ASC);

-- CreateIndex
CREATE INDEX "ix_alerts_entity_type" ON "alerts"("entity_type" ASC);

-- CreateIndex
CREATE INDEX "ix_alerts_severity" ON "alerts"("severity" ASC);

-- CreateIndex
CREATE INDEX "ix_alerts_status" ON "alerts"("status" ASC);

-- CreateIndex
CREATE INDEX "ix_api_tokens_account_id" ON "api_tokens"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_api_tokens_provider" ON "api_tokens"("provider" ASC);

-- CreateIndex
CREATE INDEX "ix_approval_events_generation_id" ON "approval_events"("generation_id" ASC);

-- CreateIndex
CREATE INDEX "ix_audit_logs_actor" ON "audit_logs"("actor" ASC);

-- CreateIndex
CREATE INDEX "ix_audit_logs_path" ON "audit_logs"("path" ASC);

-- CreateIndex
CREATE INDEX "ix_budget_snapshots_account_id" ON "budget_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_budget_snapshots_budget_date" ON "budget_snapshots"("budget_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_budget_snapshots_budget_id" ON "budget_snapshots"("budget_id" ASC);

-- CreateIndex
CREATE INDEX "ix_budget_snapshots_snapshot_date" ON "budget_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_budget_snapshots_sync_time" ON "budget_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "budgets_account_budget" ON "budgets"("account_id" ASC, "budget_id" ASC);

-- CreateIndex
CREATE INDEX "ix_budgets_account_id" ON "budgets"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_budgets_budget_id" ON "budgets"("budget_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_device_snapshots_account_id" ON "campaign_device_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_device_snapshots_campaign_id" ON "campaign_device_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_device_snapshots_device" ON "campaign_device_snapshots"("device" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_device_snapshots_snapshot_date" ON "campaign_device_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_device_snapshots_sync_time" ON "campaign_device_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_geo_snapshots_account_id" ON "campaign_geo_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_geo_snapshots_campaign_id" ON "campaign_geo_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_geo_snapshots_country_criterion_id" ON "campaign_geo_snapshots"("country_criterion_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_geo_snapshots_snapshot_date" ON "campaign_geo_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_geo_snapshots_sync_time" ON "campaign_geo_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_snapshots_account_date" ON "campaign_snapshots"("account_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_snapshots_account_id" ON "campaign_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_snapshots_campaign_date" ON "campaign_snapshots"("campaign_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_snapshots_campaign_id" ON "campaign_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_snapshots_snapshot_date" ON "campaign_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_campaign_snapshots_sync_time" ON "campaign_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_account_campaign" ON "campaigns"("account_id" ASC, "campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaigns_account_id" ON "campaigns"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaigns_budget_id" ON "campaigns"("budget_id" ASC);

-- CreateIndex
CREATE INDEX "ix_campaigns_campaign_id" ON "campaigns"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_account_date" ON "keyword_snapshots"("account_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_account_id" ON "keyword_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_ad_group_id" ON "keyword_snapshots"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_campaign_id" ON "keyword_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_keyword_date" ON "keyword_snapshots"("keyword_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_keyword_id" ON "keyword_snapshots"("keyword_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_snapshot_date" ON "keyword_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_keyword_snapshots_sync_time" ON "keyword_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE INDEX "ix_keywords_account_id" ON "keywords"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keywords_ad_group_id" ON "keywords"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keywords_criterion_id" ON "keywords"("criterion_id" ASC);

-- CreateIndex
CREATE INDEX "ix_keywords_text" ON "keywords"("text" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "keywords_adgroup_criterion" ON "keywords"("ad_group_id" ASC, "criterion_id" ASC);

-- CreateIndex
CREATE INDEX "ix_recommendations_account_id" ON "recommendations"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_recommendations_campaign_id" ON "recommendations"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_recommendations_recommendation_type" ON "recommendations"("recommendation_type" ASC);

-- CreateIndex
CREATE INDEX "ix_recommendations_resource_name" ON "recommendations"("resource_name" ASC);

-- CreateIndex
CREATE INDEX "ix_recommendations_snapshot_date" ON "recommendations"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_recommendations_sync_time" ON "recommendations"("sync_time" ASC);

-- CreateIndex
CREATE INDEX "ix_scorecard_snapshots_account_id" ON "scorecard_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_scorecard_snapshots_campus" ON "scorecard_snapshots"("campus" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_account_date" ON "search_term_snapshots"("account_id" ASC, "snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_account_id" ON "search_term_snapshots"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_ad_group_id" ON "search_term_snapshots"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_campaign_id" ON "search_term_snapshots"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_search_term_id" ON "search_term_snapshots"("search_term_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_snapshot_date" ON "search_term_snapshots"("snapshot_date" ASC);

-- CreateIndex
CREATE INDEX "ix_search_term_snapshots_sync_time" ON "search_term_snapshots"("sync_time" ASC);

-- CreateIndex
CREATE INDEX "ix_search_terms_account_id" ON "search_terms"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_terms_ad_group_id" ON "search_terms"("ad_group_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_terms_campaign_id" ON "search_terms"("campaign_id" ASC);

-- CreateIndex
CREATE INDEX "ix_search_terms_query" ON "search_terms"("query" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "search_terms_adgroup_query_match" ON "search_terms"("ad_group_id" ASC, "query" ASC, "match_type" ASC);

-- CreateIndex
CREATE INDEX "ix_sync_logs_customer_id" ON "sync_logs"("customer_id" ASC);

-- CreateIndex
CREATE INDEX "ix_sync_logs_entity" ON "sync_logs"("entity" ASC);

-- CreateIndex
CREATE INDEX "ix_sync_logs_started_at" ON "sync_logs"("started_at" ASC);

-- CreateIndex
CREATE INDEX "ix_sync_logs_status" ON "sync_logs"("status" ASC);

-- CreateIndex
CREATE INDEX "ix_sync_logs_sync_type" ON "sync_logs"("sync_type" ASC);

-- CreateIndex
CREATE INDEX "ix_user_accounts_account_id" ON "user_accounts"("account_id" ASC);

-- CreateIndex
CREATE INDEX "ix_user_accounts_user_id" ON "user_accounts"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_user_account" ON "user_accounts"("user_id" ASC, "account_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_email" ON "users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_google_sub" ON "users"("google_sub" ASC);

-- AddForeignKey
ALTER TABLE "account_budgets" ADD CONSTRAINT "fk_account_budgets_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_weekly_budgets" ADD CONSTRAINT "fk_account_weekly_budgets_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_copy_generations" ADD CONSTRAINT "fk_ad_copy_generations_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_copy_generations" ADD CONSTRAINT "fk_ad_copy_generations_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_copy_generations" ADD CONSTRAINT "fk_ad_copy_generations_owner_user_id_users" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_copy_generations" ADD CONSTRAINT "fk_ad_copy_generations_submitter_user_id_users" FOREIGN KEY ("submitter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_group_snapshots" ADD CONSTRAINT "fk_ad_group_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_group_snapshots" ADD CONSTRAINT "fk_ad_group_snapshots_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_group_snapshots" ADD CONSTRAINT "fk_ad_group_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_group_snapshots" ADD CONSTRAINT "fk_ad_group_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_groups" ADD CONSTRAINT "fk_ad_groups_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_groups" ADD CONSTRAINT "fk_ad_groups_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_snapshots" ADD CONSTRAINT "fk_ad_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_snapshots" ADD CONSTRAINT "fk_ad_snapshots_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_snapshots" ADD CONSTRAINT "fk_ad_snapshots_ad_id_ads" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_snapshots" ADD CONSTRAINT "fk_ad_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ad_snapshots" ADD CONSTRAINT "fk_ad_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "fk_ads_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "fk_ads_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "fk_alerts_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "fk_api_tokens_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "fk_approval_events_generation_id_ad_copy_generations" FOREIGN KEY ("generation_id") REFERENCES "ad_copy_generations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_snapshots" ADD CONSTRAINT "fk_budget_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_snapshots" ADD CONSTRAINT "fk_budget_snapshots_budget_id_budgets" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_snapshots" ADD CONSTRAINT "fk_budget_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_device_snapshots" ADD CONSTRAINT "fk_campaign_device_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_device_snapshots" ADD CONSTRAINT "fk_campaign_device_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_device_snapshots" ADD CONSTRAINT "fk_campaign_device_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_geo_snapshots" ADD CONSTRAINT "fk_campaign_geo_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_geo_snapshots" ADD CONSTRAINT "fk_campaign_geo_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_geo_snapshots" ADD CONSTRAINT "fk_campaign_geo_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_snapshots" ADD CONSTRAINT "fk_campaign_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_snapshots" ADD CONSTRAINT "fk_campaign_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_snapshots" ADD CONSTRAINT "fk_campaign_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "fk_campaigns_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keyword_snapshots" ADD CONSTRAINT "fk_keyword_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keyword_snapshots" ADD CONSTRAINT "fk_keyword_snapshots_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keyword_snapshots" ADD CONSTRAINT "fk_keyword_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keyword_snapshots" ADD CONSTRAINT "fk_keyword_snapshots_keyword_id_keywords" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keyword_snapshots" ADD CONSTRAINT "fk_keyword_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "fk_keywords_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "fk_keywords_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "fk_recommendations_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "fk_recommendations_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "fk_recommendations_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scorecard_snapshots" ADD CONSTRAINT "fk_scorecard_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scorecard_snapshots" ADD CONSTRAINT "fk_scorecard_snapshots_generation_id_ad_copy_generations" FOREIGN KEY ("generation_id") REFERENCES "ad_copy_generations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_term_snapshots" ADD CONSTRAINT "fk_search_term_snapshots_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_term_snapshots" ADD CONSTRAINT "fk_search_term_snapshots_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_term_snapshots" ADD CONSTRAINT "fk_search_term_snapshots_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_term_snapshots" ADD CONSTRAINT "fk_search_term_snapshots_search_term_id_search_terms" FOREIGN KEY ("search_term_id") REFERENCES "search_terms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_term_snapshots" ADD CONSTRAINT "fk_search_term_snapshots_sync_log_id_sync_logs" FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "fk_search_terms_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "fk_search_terms_ad_group_id_ad_groups" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "fk_search_terms_campaign_id_campaigns" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "fk_user_accounts_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "fk_user_accounts_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

