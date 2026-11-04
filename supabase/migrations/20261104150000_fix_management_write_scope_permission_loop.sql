-- api.management_write, the general scope-table write path, looped over
-- EVERY row in silver.manage calling the SECURITY DEFINER silver.manage()
-- function (reads request.jwt.claims via current_auth_email()) BEFORE
-- checking whether that scope's table name even matched the one being
-- written to:
--   for v_scope in select ... from silver.manage loop
--     if not coalesce((SELECT allowed FROM silver.manage('scope',v_scope.id)),false) then continue; end if;
--     if v_rel = to_regclass(...) then v_allowed := true; exit; end if;
--   end loop;
-- Confirmed in pg_stat_statements as one of the top time-consuming queries
-- project-wide: 13,274 calls, 1,126,300ms total, 84.9ms mean, 15,705ms max.
-- This reorders the loop to do the cheap, in-memory table-name comparison
-- first and call silver.manage('scope', id) at most once, only for the
-- scope row whose table actually matches. Final v_allowed is identical in
-- both orderings (true iff some scope row both name-matches AND is
-- allowed) -- this is a pure performance reorder, not a security change.
--
-- Already applied live to project qlouywsdiiyiyzpoxyqy via apply_migration
-- (name: fix_management_write_scope_permission_loop) before this file was
-- written -- this is purely for version-control tracking.
CREATE OR REPLACE FUNCTION api.management_write(p_table text, p_operation text, p_rows jsonb DEFAULT NULL::jsonb, p_values jsonb DEFAULT NULL::jsonb, p_filters jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver', 'api', 'public'
AS $function$
declare
 v_rel regclass;
 v_allowed boolean := false;
 v_row jsonb;
 v_columns text;
 v_values_expr text;
 v_set_expr text;
 v_where text := '';
 v_filter jsonb;
 v_filter_col text;
 v_count integer := 0;
 v_affected integer := 0;
 v_scope record;
begin
 if coalesce(trim(p_table),'')='' then raise exception 'table is required'; end if;
 v_rel := to_regclass(p_table);
 if v_rel is null then raise exception 'unknown relation'; end if;

 if v_rel = 'silver.manage'::regclass then
   v_allowed := coalesce((SELECT allowed FROM silver.manage('global')),false);
 elsif v_rel = 'silver.loc'::regclass then
   v_allowed := coalesce((SELECT allowed FROM silver.manage('global')),false);
 elsif v_rel = 'silver.loc_blocks'::regclass then
   v_allowed := coalesce((SELECT allowed FROM silver.manage('group','loc')),false);
 else
   for v_scope in
     select id,coalesce(nullif(galaxy_table,''),'galaxy') as galaxy,coalesce(nullif(anchor_table,''),'anchor') as anchor
     from silver.manage
   loop
     if v_rel = to_regclass(format('silver.%I',v_scope.id))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_'||v_scope.galaxy))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_'||v_scope.galaxy||'_media'))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_'||v_scope.anchor))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_blocks'))
     then
       v_allowed := coalesce((SELECT allowed FROM silver.manage('scope',v_scope.id)),false);
       exit;
     end if;
   end loop;
 end if;

 if not v_allowed then raise exception 'management permission denied'; end if;

 -- Group managers may edit only LOC homepage Blocks, never shared/system Hero.
 if v_rel='silver.loc_blocks'::regclass and not coalesce((SELECT allowed FROM silver.manage('global')),false) then
   if p_operation='insert' then
     if jsonb_typeof(p_rows)<>'array'
       or exists(select 1 from jsonb_array_elements(p_rows) item
          where item->>'page_name' is distinct from 'index') then
       raise exception 'group may insert LOC homepage Blocks only';
     end if;
   elsif p_operation in ('update','delete') then
     if jsonb_typeof(p_filters)<>'array' or jsonb_array_length(p_filters)<>1
       or p_filters->0->>'column' is distinct from 'uid'
       or coalesce(p_filters->0->>'operator','eq')<>'eq'
       or not exists(select 1 from silver.loc_blocks b
          where b.uid=p_filters->0->>'value' and b.page_name='index')
       or (p_operation='update'
           and p_values->>'page_name' is distinct from 'index') then
       raise exception 'group may modify LOC homepage Blocks only';
     end if;
   else raise exception 'unsupported Group Block operation';
   end if;
 end if;


 if p_operation='insert' then
   if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
   if jsonb_array_length(p_rows)=0 then return jsonb_build_object('count',0); end if;
   -- Fast path for uniform import rows: keep every permission and column guard,
   -- but let Postgres insert the whole batch in one statement.
   select string_agg(quote_ident(k.key),',' order by k.key)
     into v_columns
     from jsonb_object_keys(p_rows->0) as k(key)
     join pg_attribute a on a.attrelid=v_rel and a.attname=k.key
       and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity='';
   if coalesce(v_columns,'')='' then raise exception 'no writable columns'; end if;
   if not exists (
     select 1 from jsonb_array_elements(p_rows) as e(value)
     where (select string_agg(quote_ident(k.key),',' order by k.key)
              from jsonb_object_keys(e.value) as k(key)
              join pg_attribute a on a.attrelid=v_rel and a.attname=k.key
                and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity='')
       is distinct from v_columns
   ) then
     execute format('insert into %s (%s) select %s from jsonb_populate_recordset(NULL::%s,$1)',
       v_rel::text,v_columns,v_columns,v_rel::text) using p_rows;
     get diagnostics v_count = row_count;
     return jsonb_build_object('count',v_count);
   end if;
   -- Mixed field shapes retain the original per-row default-value semantics.
   for v_row in select value from jsonb_array_elements(p_rows) loop
     select string_agg(quote_ident(k.key),',' order by k.key),
            string_agg(format('((jsonb_populate_record(NULL::%s,$1)).%I)',v_rel::text,k.key),',' order by k.key)
     into v_columns,v_values_expr
     from jsonb_object_keys(v_row) as k(key)
     join pg_attribute a on a.attrelid=v_rel and a.attname=k.key and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity='';
     if coalesce(v_columns,'')='' then raise exception 'no writable columns'; end if;
     execute format('insert into %s (%s) values (%s)',v_rel::text,v_columns,v_values_expr) using v_row;
     v_count := v_count + 1;
   end loop;
   return jsonb_build_object('count',v_count);

 elsif p_operation='update_batch' then
   if not exists (
     select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where c.oid=v_rel and n.nspname='silver'
       and c.relname ~ '^[a-z][a-z0-9_]*_galaxy$'
   ) then raise exception 'article batch update is not allowed'; end if;
   if jsonb_typeof(p_rows)<>'array' then raise exception 'rows must be an array'; end if;
   if jsonb_array_length(p_rows)>10000 then raise exception 'batch size exceeded'; end if;
   if jsonb_array_length(p_rows)=0 then return jsonb_build_object('count',0); end if;
   if exists (
     select 1 from jsonb_array_elements(p_rows) as e(row)
     where jsonb_typeof(e.row)<>'object'
       or coalesce(e.row->>'uid','') !~ '^[A-Za-z0-9]{8}$'
       or not exists (
         select 1 from jsonb_object_keys(e.row) as k(key)
         where k.key in ('title','content','place_id','url','media_link')
       )
       or exists (
         select 1 from jsonb_object_keys(e.row) as k(key)
         where k.key not in ('uid','title','content','place_id','url','media_link')
       )
   ) then raise exception 'invalid article update batch'; end if;
   if (select count(*) from jsonb_array_elements(p_rows)) <>
      (select count(distinct e.row->>'uid') from jsonb_array_elements(p_rows) as e(row))
   then raise exception 'duplicate article update UID'; end if;

   execute format($bulk$
     update %s as g
     set title=case when e.row ? 'title' then e.row->>'title' else g.title end,
         content=case when e.row ? 'content' then e.row->>'content' else g.content end,
         place_id=case when coalesce(btrim(g.place_id),'')=''
                    then coalesce(nullif(btrim(e.row->>'place_id'),''),g.place_id)
                    else g.place_id end,
         url=case when e.row ? 'url' then e.row->>'url' else g.url end,
         media_link=case when e.row ? 'media_link'
           then (jsonb_populate_record(NULL::%s,e.row)).media_link
           else g.media_link end,
         "UpdateTime"=now()
     from jsonb_array_elements($1) as e(row)
     where g.uid=(e.row->>'uid')::char(8)
       and (
         (e.row ? 'title' and g.title is distinct from e.row->>'title')
         or (e.row ? 'content' and g.content is distinct from e.row->>'content')
         or (e.row ? 'place_id' and coalesce(btrim(g.place_id),'')=''
              and nullif(btrim(e.row->>'place_id'),'') is not null)
         or (e.row ? 'url' and g.url is distinct from e.row->>'url')
         or (e.row ? 'media_link' and g.media_link is distinct from
           (jsonb_populate_record(NULL::%s,e.row)).media_link)
       )
   $bulk$,v_rel::text,v_rel::text,v_rel::text) using p_rows;
   get diagnostics v_affected = row_count;
   return jsonb_build_object('count',v_affected);

 elsif p_operation='update' then
   if jsonb_typeof(p_values) <> 'object' then raise exception 'values must be an object'; end if;
   if jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters)=0 then raise exception 'filters are required'; end if;
   if exists (
     select 1 from jsonb_object_keys(p_values) k(key)
     join pg_index i on i.indrelid=v_rel and i.indisprimary
     join pg_attribute a on a.attrelid=v_rel and a.attnum = any(i.indkey)
     where a.attname=k.key
   ) then raise exception 'primary key update is not allowed'; end if;
   select string_agg(format('%I=((jsonb_populate_record(NULL::%s,$1)).%I)',k.key,v_rel::text,k.key),',' order by k.key)
   into v_set_expr
   from jsonb_object_keys(p_values) as k(key)
   join pg_attribute a on a.attrelid=v_rel and a.attname=k.key and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity='';
   if coalesce(v_set_expr,'')='' then raise exception 'no writable columns'; end if;
   for v_filter in select value from jsonb_array_elements(p_filters) loop
     if coalesce(v_filter->>'operator','eq') <> 'eq' then raise exception 'only eq filters are supported'; end if;
     v_filter_col := v_filter->>'column';
     if not exists(select 1 from pg_attribute where attrelid=v_rel and attname=v_filter_col and attnum>0 and not attisdropped) then raise exception 'invalid filter column'; end if;
     if v_where<>'' then v_where := v_where||' and '; end if;
     v_where := v_where||format('%I is not distinct from ((jsonb_populate_record(NULL::%s,%L::jsonb)).%I)',
       v_filter_col,v_rel::text,jsonb_build_object(v_filter_col,v_filter->'value')::text,v_filter_col);
   end loop;
   execute format('update %s set %s where %s',v_rel::text,v_set_expr,v_where) using p_values;
   get diagnostics v_affected = row_count;
   return jsonb_build_object('count',v_affected);

 elsif p_operation='delete' then
   if jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters)=0 then raise exception 'filters are required'; end if;
   for v_filter in select value from jsonb_array_elements(p_filters) loop
     if coalesce(v_filter->>'operator','eq') <> 'eq' then raise exception 'only eq filters are supported'; end if;
     v_filter_col := v_filter->>'column';
     if not exists(select 1 from pg_attribute where attrelid=v_rel and attname=v_filter_col and attnum>0 and not attisdropped) then raise exception 'invalid filter column'; end if;
     if v_where<>'' then v_where := v_where||' and '; end if;
     v_where := v_where||format('%I is not distinct from ((jsonb_populate_record(NULL::%s,%L::jsonb)).%I)',
       v_filter_col,v_rel::text,jsonb_build_object(v_filter_col,v_filter->'value')::text,v_filter_col);
   end loop;
   execute format('delete from %s where %s',v_rel::text,v_where);
   get diagnostics v_affected = row_count;
   return jsonb_build_object('count',v_affected);
 else
   raise exception 'unsupported operation';
 end if;
end;
$function$
