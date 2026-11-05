-- Retire the unused SQL Scope Group aggregator (culture/trace/statistics/search).
-- Current Culture reader uses the Kysely analytics gateway
-- (culture_anchors/culture_density/culture_list), not silver.scope_group().
-- No SQL routine caller or pg_depend dependent found in the live catalog
-- on 2026-11-06. Keep RESTRICT so unexpected dependencies fail closed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
BEGIN
  IF to_regprocedure('silver.scope_group(text,text)') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.refobjid=to_regprocedure('silver.scope_group(text,text)')
        AND d.deptype NOT IN ('i','e')
    ) THEN
      RAISE EXCEPTION 'Scope Group SQL function has active database dependencies';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('api','silver')
        AND p.oid<>to_regprocedure('silver.scope_group(text,text)')
        AND p.prosrc ~* '(^|[^a-z_])scope_group[[:space:]]*\('
    ) THEN
      RAISE EXCEPTION 'Scope Group SQL function is called by another installed routine';
    END IF;
  END IF;
END $guard$;

DROP FUNCTION IF EXISTS silver.scope_group(text,text) RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
