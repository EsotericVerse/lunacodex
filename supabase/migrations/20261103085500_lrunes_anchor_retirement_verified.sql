-- Applied to production via Supabase migration:
-- retire_lrunes_legacy_four_tables_after_anchor_cutover_20261103
-- The guarded source is supabase/manual/retire_lrunes_four_tables_after_client_cutover.sql.
-- This idempotent assertion documents the completed cutover for subsequent deployments.
DO $check$
BEGIN
  IF to_regclass('silver.lrunes_anchor') IS NULL OR to_regclass('silver.lrunes_daily') IS NULL
  THEN RAISE EXCEPTION 'Retained lrunes Anchor/Daily tables missing'; END IF;
  IF to_regclass('silver.lrunes_time') IS NOT NULL
   OR to_regclass('silver.lrunes_trace') IS NOT NULL
   OR to_regclass('silver.lrunes_keywords') IS NOT NULL
   OR to_regclass('silver.lrunes_galaxy_media') IS NOT NULL
  THEN RAISE EXCEPTION 'Legacy lrunes tables still present: guarded retirement must complete first'; END IF;
END $check$;
