-- Final cleanup. Apply only after the bundled Code paths above are live.
-- No RLS, GRANT, POLICY, role privileges or service-worker changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

DO $before$
BEGIN
  IF (SELECT count(*) FROM silver.loc WHERE id IN ('loc','lo3rwang','lrunes'))<>3
    THEN RAISE EXCEPTION 'LOC Group Scope List not complete'; END IF;
  IF (SELECT count(*) FROM silver.manage WHERE manage_role='reserve')<8
    THEN RAISE EXCEPTION 'Routing reserve entries not yet moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM silver.manage WHERE id='admin' AND
        jsonb_typeof(caches)='object' AND jsonb_typeof(database)='array')
    THEN RAISE EXCEPTION 'System-owned caches/database not ready'; END IF;
  IF (silver.read_app_bootstrap('loc','index')->'scope_birthdays'->>'lo3rwang') IS NULL
    THEN RAISE EXCEPTION 'Birthday RPC cutover not active'; END IF;
END $before$;

DROP TRIGGER IF EXISTS sync_loc_config_display_name ON silver.manage;
DROP FUNCTION IF EXISTS silver.sync_loc_config_name_from_registry() RESTRICT;

ALTER TABLE silver.manage
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS title_tw,
  DROP COLUMN IF EXISTS desc_tw,
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS updated_at;

-- System state now has exactly one owner: manage(id=admin).
ALTER TABLE silver.loc
  DROP COLUMN IF EXISTS caches,
  DROP COLUMN IF EXISTS database;

-- Reserved Scope IDs now live on individual manage(role=reserve) rows.
-- Email blacklist remains in LOC temporarily: moving its clear-text values
-- into manage would expose them to anon under the existing privileges.
UPDATE silver.loc SET blacklist=jsonb_set(
  blacklist,'{scopeid}','[]'::jsonb,true
) WHERE id='loc';

DO $after$
BEGIN
  IF (silver.read_app_bootstrap('loc','index')->'scope_birthdays'->>'lrunes') IS NULL
    THEN RAISE EXCEPTION 'Bootstrap failed after metadata cleanup'; END IF;
  IF NOT EXISTS (SELECT 1 FROM silver.read_scope_page_copy('lo3rwang'))
    THEN RAISE EXCEPTION 'Public page copy missing after cleanup'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='silver' AND table_name='manage'
        AND column_name IN ('display_name','title_tw','desc_tw','birthday','updated_at'))
    THEN RAISE EXCEPTION 'Legacy manage columns not removed'; END IF;
END $after$;
COMMIT;
