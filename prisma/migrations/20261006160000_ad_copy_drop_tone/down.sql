-- Rows written after the picker was removed have no tone, so the NOT NULL
-- cannot come back without inventing one for them.
UPDATE "crm_ad_copy_versions" SET "tone" = 'professional' WHERE "tone" IS NULL;
ALTER TABLE "crm_ad_copy_versions" ALTER COLUMN "tone" SET NOT NULL;
