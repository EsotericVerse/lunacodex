-- Final cutover: execute only AFTER the new runtime code and the
-- read_app_bootstrap + loc_catalog RPC have been deployed and verified.
BEGIN;
DO $check$
DECLARE
 total_themes integer;
 total_keywords integer;
BEGIN
 SELECT count(*) INTO total_themes FROM silver.loc_theme;
 SELECT count(*) INTO total_keywords FROM silver.loc_keywords;
 IF total_themes<>8 OR (SELECT jsonb_array_length(theme) FROM silver.loc WHERE id='loc')<>total_themes
 THEN RAISE EXCEPTION 'LOC theme catalog not reconciled'; END IF;
 IF (SELECT jsonb_array_length(keywords) FROM silver.loc WHERE id='loc')<>total_keywords
 THEN RAISE EXCEPTION 'LOC keywords catalog not reconciled'; END IF;
 IF EXISTS(SELECT 1 FROM silver.loc_theme t WHERE NOT EXISTS(
  SELECT 1 FROM silver.loc l,jsonb_array_elements(l.theme) entry
  WHERE l.id='loc' AND entry=to_jsonb(t)))
 OR EXISTS(SELECT 1 FROM silver.loc_keywords k WHERE NOT EXISTS(
  SELECT 1 FROM silver.loc l,jsonb_array_elements(l.keywords) entry
  WHERE l.id='loc' AND entry=to_jsonb(k)))
 THEN RAISE EXCEPTION 'LOC catalog data differs from legacy tables'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p
   WHERE p.pronamespace='silver'::regnamespace AND p.proname='read_app_bootstrap'
    AND pg_get_functiondef(p.oid) LIKE '%silver.loc_theme%')
 THEN RAISE EXCEPTION 'Bootstrap still depends on the old theme table'; END IF;
END $check$;
DROP TABLE silver.loc_theme RESTRICT;
DROP TABLE silver.loc_keywords RESTRICT;
COMMIT;
