BEGIN;

-- These five functions were confirmed to have zero callers anywhere:
--   * not referenced from app/ or supabase/functions/ (.rpc/.managedAction call sites)
--   * not referenced in any other function body (pg_proc.prosrc cross-check)
--   * not attached as a trigger (pg_trigger), used in a CHECK constraint
--     (pg_constraint), a column default (pg_attrdef), an RLS policy
--     (pg_policies) or a view (pg_views)
-- apply_scope_point_links was superseded by the portable Kysely
-- mergeScopePoints() (app/loc/providers/kysely-management.mjs), which now
-- serves the merge_scope_trace_place_names managed action. The other four
-- are orphans left over from before the four-table-into-_anchor merge
-- (protect_scoped_trace_anchor in particular: no trigger currently uses it).
-- RESTRICT (not CASCADE) so this fails loudly instead of silently if a
-- dependency was missed.

DROP FUNCTION silver.apply_scope_point_links(text,jsonb,text) RESTRICT;
DROP FUNCTION silver.cleanup_galaxy_duplicates(text,boolean) RESTRICT;
DROP FUNCTION silver.protect_scoped_trace_anchor() RESTRICT;
DROP FUNCTION silver.galaxy_uids_with_newline(text,text[]) RESTRICT;
DROP FUNCTION silver.generate_galaxy_media_uid8() RESTRICT;

NOTIFY pgrst, 'reload schema';

COMMIT;
