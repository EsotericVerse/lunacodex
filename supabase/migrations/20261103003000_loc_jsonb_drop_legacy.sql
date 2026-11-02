BEGIN;
-- Final cutover is applied ONLY after the Cloudflare main deployment succeeds.
-- Keep explicit verification and RESTRICT: do not delete an active dependency.
DO $check$
DECLARE l record;
BEGIN
 SELECT caches,database,blacklist INTO l FROM silver.loc WHERE id='loc';
 IF NOT FOUND OR jsonb_typeof(l.caches)<>'object' OR
   jsonb_typeof(l.caches->'isr_domains')<>'array' OR
   jsonb_typeof(l.caches->'io_limits')<>'object' OR
   jsonb_typeof(l.database)<>'array' OR
   jsonb_typeof(l.blacklist->'email')<>'array' OR
   jsonb_typeof(l.blacklist->'scopeid')<>'array'
 THEN RAISE EXCEPTION 'LOC JSONB columns not ready for retired table drop'; END IF;
 IF (SELECT count(*) FROM silver.loc_dblists)<>jsonb_array_length(l.database) OR
    (SELECT count(*) FROM silver.email_blocklist)<>jsonb_array_length(l.blacklist->'email') OR
    (SELECT count(*) FROM silver.block_scopeid)<>jsonb_array_length(l.blacklist->'scopeid')
 THEN RAISE EXCEPTION 'LOC retirement blocked: source row counts differ'; END IF;
END $check$;

ALTER TABLE silver.loc DROP COLUMN cache;
DROP TABLE silver.loc_runtime_config RESTRICT;
DROP TABLE silver.loc_dblists RESTRICT;
DROP TABLE silver.email_blocklist RESTRICT;
DROP TABLE silver.block_scopeid RESTRICT;
COMMIT;