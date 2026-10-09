-- Sitelinks, and the research the copy was written from.
--
-- A saved version held headlines and descriptions only, which is less than
-- an Ads person actually hands over at launch: the six sitelinks are built
-- in the same pass and were being copied out of the screen by hand.
--
-- `keywords` stores the uploaded Keyword Research export — the keyword and
-- its average monthly searches — alongside the copy it produced. Keeping
-- them together is the point: six months later "why does this ad say that"
-- is answerable, because the list the model was given is still attached.
ALTER TABLE "crm_ad_copy_versions"
  ADD COLUMN "sitelinks" JSONB,
  ADD COLUMN "keywords" JSONB;
