BEGIN;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS caches jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS database jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS blacklist jsonb NOT NULL DEFAULT '{"email":[],"scopeid":[]}'::jsonb;
UPDATE silver.loc l SET
 caches=(SELECT jsonb_build_object('cache_mode',r.cache_mode,'cache_provider',r.cache_provider,'isr_domains',r.isr_domains,'io_limits',r.io_limits)
          FROM silver.loc_runtime_config r WHERE r.id=l.id),
 database=COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.target_id) FROM silver.loc_dblists d),'[]'::jsonb),
 blacklist=jsonb_build_object(
  'email',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.email) FROM silver.email_blocklist e),'[]'::jsonb),
  'scopeid',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM silver.block_scopeid s),'[]'::jsonb))
WHERE l.id='loc';
DO $check$
DECLARE l record;
BEGIN
 SELECT caches,database,blacklist INTO l FROM silver.loc WHERE id='loc';
 IF l.caches IS NULL OR jsonb_typeof(l.caches)<>'object' OR
   (l.caches->>'cache_mode') IS DISTINCT FROM (SELECT cache_mode FROM silver.loc_runtime_config WHERE id='loc') OR
   l.caches->'isr_domains' IS DISTINCT FROM (SELECT isr_domains FROM silver.loc_runtime_config WHERE id='loc') OR
   jsonb_array_length(l.database)<>(SELECT count(*) FROM silver.loc_dblists) OR
   jsonb_array_length(l.blacklist->'email')<>(SELECT count(*) FROM silver.email_blocklist) OR
   jsonb_array_length(l.blacklist->'scopeid')<>(SELECT count(*) FROM silver.block_scopeid)
 THEN RAISE EXCEPTION 'LOC JSONB data migration verification failed'; END IF;
END $check$;
-- These private collections must never become publicly selectable through LOC.
REVOKE SELECT,UPDATE ON TABLE silver.loc FROM anon,authenticated;
GRANT SELECT(id,display_name,locale,"DefaultArticleClass",caches) ON silver.loc TO anon,authenticated;
GRANT UPDATE(display_name,locale,"DefaultArticleClass",caches) ON silver.loc TO authenticated;
COMMIT;