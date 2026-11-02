BEGIN;
CREATE OR REPLACE FUNCTION silver.read_loc_statistics(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  r record; v_scopes jsonb := '[]'::jsonb; v_rows jsonb := '[]'::jsonb; v_part jsonb;
  v_e date; v_earliest date;
begin
  for r in select id as scope_id, display_name from silver.manage
           where active and manage_role = 'scope' order by sort_order, id loop
    if r.scope_id !~ '^[a-z][a-z0-9]{0,14}$'
       or to_regclass(format('silver.%I', r.scope_id || '_galaxy')) is null
       or to_regclass(format('silver.%I',r.scope_id||'_'||
         (select coalesce(nullif(anchor_table,''),'anchor') from silver.manage where id=r.scope_id))) is null then
      continue;
    end if;
    v_scopes := v_scopes || jsonb_build_array(jsonb_build_object('scope_id', r.scope_id, 'display_name', r.display_name));
    select coalesce(jsonb_agg(jsonb_build_object('scope_id', r.scope_id, 'day', t.day, 'item_count', t.n) order by t.day), '[]'::jsonb)
      into v_part
      from (select s.day, sum(s.item_count)::integer as n
            from silver.read_scope_statistics(r.scope_id, p_start, p_end, false) s
            where s.kind = 'total' group by s.day) t;
    v_rows := v_rows || v_part;
    v_e := silver.read_scope_earliest(r.scope_id);
    if v_e is not null and (v_earliest is null or v_e < v_earliest) then v_earliest := v_e; end if;
  end loop;
  -- Daily Rune is a Settings calendar, not part of general Scope statistics.
  return jsonb_build_object('earliest', v_earliest, 'scopes', v_scopes, 'rows', v_rows);
end;
$function$
;
COMMIT;
