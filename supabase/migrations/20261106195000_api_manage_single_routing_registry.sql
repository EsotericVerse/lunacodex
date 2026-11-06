-- Single canonical LOC routing/authorization registry: api.manage.
-- Exact identifier replacement only; never rewrite unrelated silver objects.
-- Existing api.manage rows MUST match the old registry before the cutover.
-- This migration changes no Galaxy, Anchor, Blocks, index or attr schema.
BEGIN;
SET LOCAL statement_timeout = '90s';

DO $cutover$
DECLARE
  fn record;
  pol record;
  v_definition text;
  v_qual text;
  v_check text;
  v_command text;
  function_source text;
BEGIN
  IF to_regprocedure('silver.manage(text,text)') IS NULL THEN
    RAISE EXCEPTION 'silver.manage function is missing before cutover';
  END IF;
  IF to_regclass('api.manage') IS NULL OR to_regclass('silver.manage') IS NULL THEN
    RAISE EXCEPTION 'Both registries must exist before cutover';
  END IF;
  -- Small routing registry only; no Galaxy or Anchor full-data comparison.
  IF EXISTS (
    SELECT 1 FROM api.manage a FULL JOIN silver.manage s USING (id)
    WHERE a.id IS NULL OR s.id IS NULL OR to_jsonb(a) IS DISTINCT FROM to_jsonb(s)
  ) THEN
    RAISE EXCEPTION 'api.manage differs from silver.manage; no objects were modified';
  END IF;

  -- Preserve the exact signature, SECURITY DEFINER and signed-identity logic.
  -- PostgreSQL's negative lookahead prevents rewriting silver.manage_* names.
  SELECT regexp_replace(pg_get_functiondef('silver.manage(text,text)'::regprocedure),
           'silver[.]manage(?![[:alnum:]_])','api.manage','g')
    INTO function_source;
  EXECUTE function_source;
  -- Match the original restricted EXECUTE rights. Never expose this function
  -- to anonymous clients or PUBLIC by default.
  REVOKE ALL ON FUNCTION api.manage(text,text) FROM PUBLIC, anon, service_role;
  GRANT EXECUTE ON FUNCTION api.manage(text,text) TO authenticated;

  -- Every live RLS policy retains the same expression, command and roles.
  FOR pol IN
    SELECT schemaname,tablename,policyname,qual,with_check
    FROM pg_policies
    WHERE (qual ~ 'silver[.]manage(?![[:alnum:]_])'
        OR with_check ~ 'silver[.]manage(?![[:alnum:]_])')
  LOOP
    v_command:=format('ALTER POLICY %I ON %I.%I',pol.policyname,pol.schemaname,pol.tablename);
    IF pol.qual IS NOT NULL THEN
      v_qual:=regexp_replace(pol.qual,'silver[.]manage(?![[:alnum:]_])','api.manage','g');
      v_command:=v_command||format(' USING (%s)',v_qual);
    END IF;
    IF pol.with_check IS NOT NULL THEN
      v_check:=regexp_replace(pol.with_check,'silver[.]manage(?![[:alnum:]_])','api.manage','g');
      v_command:=v_command||format(' WITH CHECK (%s)',v_check);
    END IF;
    EXECUTE v_command;
  END LOOP;

  -- Preserve the existing security_invoker option on this View.
  SELECT pg_get_viewdef('api.lo3rwang_keywords_manage'::regclass,true)
    INTO v_definition;
  IF v_definition NOT LIKE '%silver.manage%' THEN
    RAISE EXCEPTION 'Expected LOC management View dependency was not found';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW api.lo3rwang_keywords_manage AS '||
    regexp_replace(v_definition,'silver[.]manage(?![[:alnum:]_])','api.manage','g');

  -- Replace exact SQL references inside older functions too: these must not
  -- outlive the old registry table. CREATE OR REPLACE preserves signatures.
  FOR fn IN
    SELECT p.oid,p.proname,n.nspname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('silver','api') AND p.oid<>'silver.manage(text,text)'::regprocedure
      AND p.prosrc ~ 'silver[.]manage(?![[:alnum:]_])'
  LOOP
    EXECUTE regexp_replace(pg_get_functiondef(fn.oid),
      'silver[.]manage(?![[:alnum:]_])','api.manage','g');
  END LOOP;

  -- Verify the precise old identifier is gone from live policy/view/function
  -- definitions before dropping anything.
  IF EXISTS (SELECT 1 FROM pg_policies
     WHERE qual ~ 'silver[.]manage(?![[:alnum:]_])'
        OR with_check ~ 'silver[.]manage(?![[:alnum:]_])')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN('api','silver') AND p.oid<>'silver.manage(text,text)'::regprocedure
         AND p.prosrc ~ 'silver[.]manage(?![[:alnum:]_])')
     OR pg_get_viewdef('api.lo3rwang_keywords_manage'::regclass,true) ~
       'silver[.]manage(?![[:alnum:]_])'
  THEN
    RAISE EXCEPTION 'Old silver.manage references remain; aborting retirement';
  END IF;
END
$cutover$;

DROP FUNCTION silver.manage(text,text) RESTRICT;
DROP TABLE silver.manage RESTRICT;
COMMIT;
