-- 2026-11-04: remove forced search/list changes from the transitional Galaxy.attr sync.
-- Existing transition trigger remains until all readers/writers use attr only.
-- Retains full prior migration history; applies equally on Supabase and Neon.
DO $migration$
DECLARE
  ddl text;
  start_marker constant text := '  -- Preserve existing public-search/MCP invariants in either write path.';
  end_marker constant text := '  NEW.attr := pg_catalog.jsonb_build_object(';
  i integer;
  j integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO ddl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='silver' AND p.proname='sync_galaxy_capability_attr';
  IF ddl IS NULL THEN
    RAISE NOTICE 'Galaxy sync function already retired';
    RETURN;
  END IF;
  i := strpos(ddl,start_marker);
  IF i=0 THEN
    IF strpos(ddl,'NEW.attr := pg_catalog.jsonb_build_object(')>0
      AND strpos(ddl,'NEW.search := false;')=0
      AND strpos(ddl,'NEW."list" := false;')=0 THEN
      RAISE NOTICE 'Forced Galaxy capability overrides already removed';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Unrecognized Galaxy sync function: manual review required';
  END IF;
  j := strpos(ddl,end_marker);
  IF j<=i THEN RAISE EXCEPTION 'Unexpected Galaxy sync definition'; END IF;
  EXECUTE left(ddl,i-1)||substr(ddl,j);
END
$migration$;
