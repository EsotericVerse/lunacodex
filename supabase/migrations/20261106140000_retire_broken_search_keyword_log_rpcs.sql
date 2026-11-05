-- Retire obsolete database search-keyword logging RPCs.
-- api.log_search_keyword writes to silver.loc_search_keywords, a retired table.
-- Current site search uses the Kysely/article search flow; this is NOT the
-- current search QoS or blacklist mechanism.
-- No live SQL callers or pg_depend dependents observed on 2026-11-06.
-- Do not re-create the legacy logging table.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $verify$
DECLARE target regprocedure;
BEGIN
  IF to_regclass('silver.loc_search_keywords') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy keyword log relation exists; re-audit consumers before retirement';
  END IF;
  FOREACH target IN ARRAY ARRAY[
    to_regprocedure('silver.log_search_keyword(text,text)'),
    to_regprocedure('api.log_search_keyword(text,text)')
  ] LOOP
    IF target IS NULL THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.refobjid=target::oid AND d.deptype NOT IN ('i','e')
    ) THEN
      RAISE EXCEPTION 'Legacy search keyword logger still has database dependencies: %',target;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('silver','api')
      AND p.proname <> 'log_search_keyword'
      AND p.prosrc ILIKE '%log_search_keyword%'
  ) THEN
    RAISE EXCEPTION 'Other database routines still invoke the old keyword logger';
  END IF;
END $verify$;

DROP FUNCTION IF EXISTS silver.log_search_keyword(text,text) RESTRICT;
DROP FUNCTION IF EXISTS api.log_search_keyword(text,text) RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
