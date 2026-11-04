-- Galaxy permission gates in analytic RPCs use canonical attr JSONB.
-- Only update known procedure bodies. No function signatures, ACL, or ownership change.
DO $migration$
DECLARE
  item record;
  ddl text;
  changes integer;
BEGIN
  FOR item IN
    SELECT p.oid,p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='silver' AND p.prokind='f'
      AND p.proname IN ('read_scope_linked_media_count',
                       'read_trace_keyword_group_totals','read_trace_place_density')
  LOOP
    ddl:=pg_get_functiondef(item.oid);
    changes:=0;
    IF item.proname='read_scope_linked_media_count' THEN
      IF strpos(ddl,'(g.statics)::boolean IS TRUE')>0 THEN
        ddl:=replace(ddl,'(g.statics)::boolean IS TRUE','(g.attr->>''statics'')::boolean IS TRUE');
        changes:=1;
      END IF;
    ELSIF item.proname='read_trace_keyword_group_totals' THEN
      IF strpos(ddl,'(g.keyword)::boolean IS TRUE')>0 THEN
        ddl:=replace(ddl,'(g.keyword)::boolean IS TRUE','(g.attr->>''keyword'')::boolean IS TRUE');
        changes:=1;
      END IF;
    ELSE
      IF strpos(ddl,'(g.trace)::boolean IS TRUE')>0 THEN
        ddl:=replace(ddl,'(g.trace)::boolean IS TRUE','(g.attr->>''trace'')::boolean IS TRUE');
        changes:=1;
      END IF;
    END IF;
    IF changes=1 THEN EXECUTE ddl;
    ELSIF strpos(ddl,'g.attr->>')=0 THEN
      RAISE EXCEPTION 'RPC % has unrecognized permission SQL',item.proname;
    END IF;
  END LOOP;
END $migration$;