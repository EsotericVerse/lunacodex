BEGIN;
SET LOCAL lock_timeout='8s';
REVOKE ALL ON FUNCTION silver.apply_scope_point_links(text,jsonb,text) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
