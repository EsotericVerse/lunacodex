BEGIN;
SET LOCAL lock_timeout='8s';
DROP FUNCTION IF EXISTS silver.apply_timeline_place_ids(text,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS silver.apply_timeline_missing_places(text,jsonb) RESTRICT;
DO $$
BEGIN
 IF to_regprocedure('silver.apply_scope_point_links(text,jsonb,text)') IS NULL THEN
  RAISE EXCEPTION 'Canonical point link RPC missing';
 END IF;
END $$;
COMMIT;
