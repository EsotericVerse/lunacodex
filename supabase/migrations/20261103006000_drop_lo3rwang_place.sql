BEGIN;
-- The former alias relation is empty; native Point.attr.location is the source
-- of truth. Path/Trace references are already in Anchor.attr.point / attr.path.
DO $check$
BEGIN
  IF (SELECT count(*) FROM silver.lo3rwang_place)<>0 THEN
    RAISE EXCEPTION 'Old place table is nonempty; do not discard aliases';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='silver'::regnamespace
     AND proname='save_scope_trace_place_names'
     AND pg_get_functiondef(oid) LIKE '%lo3rwang_anchor%') OR
     NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='silver'::regnamespace
     AND proname='search_scope_trace_place_names'
     AND pg_get_functiondef(oid) LIKE '%jsonb_array_elements_text%') OR
     NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='silver'::regnamespace
     AND proname='merge_scope_trace_place_names'
     AND pg_get_functiondef(oid) LIKE '%lo3rwang_anchor%') THEN
    RAISE EXCEPTION 'Native Point alias and merge functions not verified';
  END IF;
END $check$;
DROP TABLE silver.lo3rwang_place RESTRICT;
COMMIT;