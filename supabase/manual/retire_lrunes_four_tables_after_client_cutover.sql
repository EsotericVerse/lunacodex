-- MANUAL CUTOVER: execute only after the client adapter and importer on main
-- read/write silver.lrunes_anchor for all time, trace, keyword and media types.
-- DO NOT run while app/loc/unified-anchor-compat.mjs still limits unifiedAnchorSpec to lo3rwang.
-- This file is deliberately NOT under supabase/migrations to avoid premature deployment.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
SELECT pg_catalog.pg_advisory_xact_lock(82110603, 144);

DO $check$
BEGIN
  IF to_regclass('silver.lrunes_daily') IS NULL OR to_regclass('silver.lrunes_anchor') IS NULL THEN
    RAISE EXCEPTION 'Required lrunes_daily / lrunes_anchor is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM silver.lrunes WHERE id='lrunes'
       AND length(current_keyword_class_uid)=8) THEN
    RAISE EXCEPTION 'lrunes current Class UID is not migrated to Anchor';
  END IF;
  IF EXISTS(SELECT 1 FROM silver.lrunes_time t
     WHERE NOT EXISTS(SELECT 1 FROM silver.lrunes_anchor a
        WHERE a.title=t.title AND a.type=CASE WHEN t.type='anchor' THEN 'date' ELSE t.type END))
  THEN RAISE EXCEPTION 'Legacy lrunes_time rows missing from Anchor'; END IF;
  IF EXISTS(SELECT 1 FROM silver.lrunes_keywords k
     WHERE NOT EXISTS(SELECT 1 FROM silver.lrunes_anchor a
         WHERE a.type=k.type AND a.title=k.name))
  THEN RAISE EXCEPTION 'Legacy lrunes_keywords rows missing from Anchor'; END IF;
  IF EXISTS(SELECT 1 FROM silver.lrunes_galaxy_media m
     WHERE NOT EXISTS(SELECT 1 FROM silver.lrunes_anchor a
         WHERE a.uid=m.uid AND (a.type=m.type OR (m.type='instagram' AND a.type IN ('image','video')))
           AND a.title IS NOT DISTINCT FROM m.title
           AND a.attr->>'url' IS NOT DISTINCT FROM m.url))
  THEN RAISE EXCEPTION 'Legacy media UID/title/URL mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM silver.lrunes_galaxy_media m
     JOIN silver.lrunes_anchor a USING(uid)
     WHERE m.type='rune' AND a.attr->'rune' IS DISTINCT FROM m.meta_tags::jsonb)
  THEN RAISE EXCEPTION 'rune_ref spread detail was not preserved'; END IF;
  IF EXISTS(SELECT 1 FROM silver.lrunes_galaxy g
     CROSS JOIN LATERAL unnest(coalesce(g.media_link,'{}'::varchar[])) ref(uid)
     WHERE NOT EXISTS(SELECT 1 FROM silver.lrunes_anchor a WHERE a.uid=ref.uid))
  THEN RAISE EXCEPTION 'Dangling Galaxy media links'; END IF;
  IF EXISTS(SELECT 1 FROM silver.lrunes_anchor a
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN a.type IN ('category','class','group')
         THEN coalesce(a.attr->'uid','[]'::jsonb)
         WHEN a.type='period' THEN coalesce(a.attr->'uid','[]'::jsonb)
         WHEN a.type='era' THEN coalesce(a.attr->'period','[]'::jsonb)
         ELSE '[]'::jsonb END) child(uid)
     WHERE NOT EXISTS(SELECT 1 FROM silver.lrunes_anchor b WHERE b.uid=child.uid))
  THEN RAISE EXCEPTION 'Dangling Anchor keyword/time UIDs'; END IF;
END $check$;

-- Drops only the four superseded lrunes tables, never lrunes_daily.
DROP TABLE silver.lrunes_time RESTRICT;
DROP TABLE silver.lrunes_trace RESTRICT;
DROP TABLE silver.lrunes_keywords RESTRICT;
DROP TABLE silver.lrunes_galaxy_media RESTRICT;
DROP FUNCTION IF EXISTS silver.refresh_scoped_time_ranges() RESTRICT;
DO $verify$
BEGIN
  IF to_regclass('silver.lrunes_daily') IS NULL OR
     to_regclass('silver.lrunes_anchor') IS NULL THEN
     RAISE EXCEPTION 'Required lrunes relations not retained';
  END IF;
END $verify$;
COMMIT;
