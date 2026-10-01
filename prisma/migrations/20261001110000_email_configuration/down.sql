-- Rollback for 20261001110000_email_configuration.
DROP TABLE IF EXISTS "crm_email_routes";
DROP TABLE IF EXISTS "crm_email_settings";
DROP TYPE IF EXISTS "CrmEmailAudience";
