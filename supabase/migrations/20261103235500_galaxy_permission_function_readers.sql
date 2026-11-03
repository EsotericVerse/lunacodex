-- Stage 2: update existing RPC bodies to read physical Galaxy flags.
-- Rewrites only well-known JSON field expressions, retaining each function's
-- signature, return type, security mode and ownership. Does NOT add any RPC.
DO $do$
DECLARE
  fn record;
  definition text;
  original text;
  old_key text;
  new_key text;
  quote_count int;
  spacer text;
BEGIN
  FOR fn IN
    SELECT p.oid,p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='silver' AND p.prokind='f' AND p.proname IN (
       'read_keyword_tree_summary','read_scope_category_totals',
       'read_scope_earliest','read_scope_linked_media_count',
       'read_scope_place_statistics','read_scope_statistics',
       'read_trace_keyword_group_totals','read_trace_place_density',
       'refresh_scope_search_summary')
  LOOP
    definition:=pg_get_functiondef(fn.oid);
    original:=definition;
    FOREACH old_key IN ARRAY ARRAY[
      'statics','culture','search','trace','list','keywords','game','extract']
    LOOP
      new_key:=CASE old_key WHEN 'keywords' THEN 'keyword'
                            WHEN 'game' THEN 'others'
                            WHEN 'list' THEN '"list"'
                            ELSE old_key END;
      FOR quote_count IN 1..2 LOOP
        FOREACH spacer IN ARRAY ARRAY['',' '] LOOP
          definition:=replace(definition,
            'able'||spacer||'->>'||spacer||repeat(chr(39),quote_count)||
            old_key||repeat(chr(39),quote_count),new_key);
        END LOOP;
      END LOOP;
    END LOOP;
    IF definition=original THEN
      RAISE EXCEPTION 'Expected Galaxy permission reference missing from RPC: %',fn.proname;
    END IF;
    EXECUTE definition;
  END LOOP;
END $do$;

-- RLS and trigger retain the old JSON reader until the full client switch.
-- DROP COLUMN is intentionally excluded from this staging migration.
