-- Retire replaced / unused legacy SQL Scope helper RPCs.
-- Current Galaxy duplicate scan and Scope site rename use the Kysely managed
-- action provider. EXIF import is handled separately in Local SQLite; there
-- is no active PostgreSQL/Edge caller for the old save_archive_media_exif RPC.
-- Audit date: 2026-11-06; live pg_depend and SQL routine callers both zero.
-- Do not drop tables, content, or change the current managed-action API.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
DECLARE
  fn_name text;
  signature text;
  fn_oid oid;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'silver.find_galaxy_duplicates(text)',
    'silver.rename_scope_site_batch(text,text,text,integer)',
    'silver.save_archive_media_exif(text,jsonb)'
  ] LOOP
    fn_oid := to_regprocedure(signature);
    IF fn_oid IS NULL THEN CONTINUE; END IF;
    fn_name := split_part(split_part(signature,'.',2),'(',1);
    IF EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.refobjid=fn_oid AND d.deptype NOT IN ('i','e')
    ) THEN
      RAISE EXCEPTION 'Legacy Scope helper still has SQL dependencies: %',signature;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('api','silver') AND p.oid<>fn_oid
        AND p.prosrc ILIKE '%'||fn_name||'%'
    ) THEN
      RAISE EXCEPTION 'Legacy Scope helper is still called by installed SQL: %',signature;
    END IF;
  END LOOP;
END $guard$;

DROP FUNCTION IF EXISTS silver.find_galaxy_duplicates(text) RESTRICT;
DROP FUNCTION IF EXISTS silver.rename_scope_site_batch(text,text,text,integer) RESTRICT;
DROP FUNCTION IF EXISTS silver.save_archive_media_exif(text,jsonb) RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
