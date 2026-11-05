-- Retire old Supabase RPC Scope lifecycle after Kysely managed-action cutover.
-- The current application calls executeKyselyScopeAdmin (provision_scope/delete_scope).
-- These old api.* functions still reference deleted _time/_trace/_keywords/_galaxy_media tables.
-- RESTRICT prevents accidental deletion of dependent database objects.
-- This migration neither drops Scope tables nor alters any business records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.refobjid IN (
      coalesce(to_regprocedure('api.delete_scope(text)'),0::oid),
      coalesce(to_regprocedure('api.provision_scope(text,text,text,date,text,text,text,text,boolean)'),0::oid)
    )
      AND d.deptype NOT IN ('i','e')
  ) THEN
    RAISE EXCEPTION 'Legacy API Scope functions still have SQL dependencies';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('api','silver')
      AND p.oid NOT IN (
        coalesce(to_regprocedure('api.delete_scope(text)'),0::oid),
        coalesce(to_regprocedure('api.provision_scope(text,text,text,date,text,text,text,text,boolean)'),0::oid)
      )
      AND (p.prosrc ILIKE '%api.delete_scope%' OR p.prosrc ILIKE '%api.provision_scope%')
  ) THEN
    RAISE EXCEPTION 'Legacy API Scope functions are still called from installed SQL';
  END IF;
END $guard$;

DROP FUNCTION IF EXISTS api.delete_scope(text) RESTRICT;
DROP FUNCTION IF EXISTS api.provision_scope(text,text,text,date,text,text,text,text,boolean) RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
