BEGIN;
SET LOCAL lock_timeout='8s';
DROP FUNCTION IF EXISTS silver.preview_timeline_place_page_json(text,jsonb,integer,integer) RESTRICT;
DROP FUNCTION IF EXISTS silver.preview_timeline_missing_place_windows(text,jsonb,integer,integer) RESTRICT;
NOTIFY pgrst, 'reload schema';
COMMIT;
