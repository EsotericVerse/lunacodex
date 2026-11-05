-- Existing functions read Group-owned Scope names, page copy and birthdays.
-- No RLS, GRANT, permission predicates or function signatures are changed.
BEGIN;
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.manage(p_type text, p_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, email text, role text, galaxy text, anchor text, birthday date, allowed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text := lower(btrim(coalesce(p_type,'')));
  v_id text := lower(btrim(coalesce(p_id,'')));
  v_email text := coalesce(silver.current_auth_email(),'');
  v_allowed boolean;
BEGIN
  IF v_type NOT IN ('self','global','group','scope') THEN
    RAISE EXCEPTION 'Invalid management type' USING ERRCODE='22023';
  END IF;
  IF v_type IN ('group','scope') AND v_id !~ '^[a-z][a-z0-9]{0,14}$' THEN
    RAISE EXCEPTION 'Invalid management id' USING ERRCODE='22023';
  END IF;
  IF v_email='' OR EXISTS (
    SELECT 1 FROM silver.loc l
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(coalesce(l.blacklist->'email','[]'::jsonb)) b(value)
    WHERE l.id='loc' AND lower(b.value->>'email')=v_email
  ) THEN
    IF v_type<>'self' THEN
      RETURN QUERY SELECT v_id,NULL::text,v_type,NULL::text,NULL::text,NULL::date,false;
    END IF;
    RETURN;
  END IF;
  IF v_type='self' THEN
    RETURN QUERY
      SELECT m.id,m.email,m.manage_role::text,m.galaxy_table,m.anchor_table,l.birthday,true
      FROM silver.manage m LEFT JOIN silver.loc l ON l.id=m.id
      WHERE lower(m.email)=v_email
        AND m.manage_role IN ('admin','group','scope')
        AND (m.manage_role='admin' OR m.active IS TRUE)
      ORDER BY m.id;
    RETURN;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM silver.manage m WHERE lower(m.email)=v_email AND (
      (m.id='admin' AND m.manage_role='admin')
      OR (v_type='group' AND m.manage_role='group' AND m.id=v_id AND m.active IS TRUE)
      OR (v_type='scope' AND m.active IS TRUE AND (
        (m.manage_role='scope' AND m.id=v_id)
        OR (v_id='loc' AND m.manage_role='group' AND m.id='loc')
      ))
    )
  ) INTO v_allowed;
  RETURN QUERY SELECT v_id,NULL::text,v_type,NULL::text,NULL::text,NULL::date,v_allowed;
END $function$;

CREATE OR REPLACE FUNCTION silver.read_scope_registry_admin()
 RETURNS TABLE(id text, display_name text, email text, manage_role text, domain text, directory text, parent_scope_id text, active boolean, sort_order integer, galaxy_table text, anchor_table text, birthday date, title_tw text, desc_tw text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT m.id,l.display_name,m.email,m.manage_role,m.domain,m.directory,
 m.parent_scope_id,m.active,m.sort_order,m.galaxy_table,m.anchor_table,
 l.birthday,l.title_tw,l.desc_tw
 FROM silver.manage AS m LEFT JOIN silver.loc AS l ON l.id=m.id
 WHERE coalesce((SELECT allowed FROM silver.manage('global')),false)
   AND m.manage_role IS DISTINCT FROM 'reserve'
 ORDER BY m.sort_order,m.id;
$function$;

CREATE OR REPLACE FUNCTION silver.read_scope_page_copy(p_scope_id text)
 RETURNS TABLE("Title_TW" text, "Desc_TW" text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(l.title_tw),''), nullif(btrim(l.desc_tw),'')
  FROM silver.loc AS l INNER JOIN silver.manage AS m ON m.id=l.id
  WHERE l.id=lower(btrim(p_scope_id))
    AND lower(btrim(p_scope_id)) ~ '^[a-z][a-z0-9]{0,14}$'
    AND m.manage_role='scope' AND m.active IS TRUE
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION silver.read_group_members(p_group_id text)
 RETURNS TABLE(id text, display_name text, parent_scope_id text, active boolean, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select m.id,l.display_name,m.parent_scope_id,m.active,m.sort_order
 from silver.manage m inner join silver.loc l on l.id=m.id
 where coalesce((SELECT allowed FROM silver.manage('group',p_group_id)),false)
   and m.parent_scope_id=lower(btrim(p_group_id))
   and m.manage_role='scope'
 order by m.sort_order,m.id
$function$;

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
  for r in select m.id as scope_id, l.display_name
           from silver.manage m inner join silver.loc l on l.id=m.id
           where m.active and m.manage_role = 'scope' order by m.sort_order, m.id loop
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
$function$;

CREATE OR REPLACE FUNCTION silver.scope_group(p_group_id text, p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_group text:=lower(btrim(coalesce(p_group_id,'')));
 v_type text:=lower(btrim(coalesce(p_type,'')));
 v_scopes jsonb:='[]'::jsonb;
 v_rows jsonb:='[]'::jsonb;
 v_part jsonb;
 v_item jsonb;
 v_scope record;
 v_kind text;
 v_offset integer;
 v_start date;
 v_end date;
 v_local_start date;
 v_local_end date;
 v_dates jsonb;
 v_begin_text text;
 v_end_text text;
 v_count integer:=0;
 v_owner boolean;
 v_relation text;
BEGIN
 IF v_group !~ '^[a-z][a-z0-9]{0,14}$'
    OR v_type NOT IN ('culture','trace','statistics','search')
 THEN RAISE EXCEPTION 'Invalid group or type' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM silver.manage WHERE id=v_group AND manage_role='group' AND active IS TRUE)
 THEN RAISE EXCEPTION 'Unknown or inactive group' USING ERRCODE='22023'; END IF;
 FOR v_scope IN
  SELECT m.id,l.display_name,m.anchor_table
  FROM silver.manage m JOIN silver.loc l ON l.id=m.id
  WHERE m.parent_scope_id=v_group AND m.manage_role='scope' AND m.active IS TRUE
    AND m.id ~ '^[a-z][a-z0-9]{0,14}$'
    AND pg_catalog.to_regclass(pg_catalog.format('silver.%I',m.id||'_'||coalesce(nullif(m.anchor_table,''),'anchor'))) IS NOT NULL
    AND pg_catalog.to_regclass(pg_catalog.format('silver.%I',m.id||'_'||coalesce(nullif(m.galaxy_table,''),'galaxy'))) IS NOT NULL
  ORDER BY m.sort_order,m.id
 LOOP
  v_scopes:=v_scopes||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('scope_id',v_scope.id,'display_name',v_scope.display_name));
  IF v_type='statistics' THEN
    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('scope_id',v_scope.id,'day',x.day,'item_count',x.item_count) ORDER BY x.day),'[]'::jsonb)
    INTO v_part FROM silver.read_scope_statistics(v_scope.id,NULL,NULL,false) x WHERE x.kind='total';
    v_rows:=v_rows||v_part;
  ELSIF v_type IN ('culture','trace') THEN
    v_local_start:=NULL;v_local_end:=NULL;
    v_relation:=v_scope.id||'_'||coalesce(nullif(v_scope.anchor_table,''),'anchor');
    v_owner:=coalesce((SELECT allowed FROM silver.manage('scope',v_scope.id)),false);
    FOREACH v_kind IN ARRAY (CASE WHEN v_type='culture' THEN ARRAY['era','period','date'] ELSE ARRAY['point','path','trace'] END) LOOP
     -- One type query, one frozen result: no UID sort or unstable OFFSET
     -- iteration across tied Anchor creation timestamps.
     EXECUTE pg_catalog.format($q$
       SELECT coalesce(pg_catalog.jsonb_agg(to_jsonb(x)),'[]'::jsonb)
       FROM (SELECT uid,type,title,description,invisible,attr
         FROM silver.%I WHERE type=$1 AND ($2 OR invisible IS FALSE)) x
     $q$,v_relation) INTO v_part USING v_kind,v_owner;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_part) x(value) LOOP
       IF v_type='culture' THEN
        v_dates:=v_item->'attr'->'date';
        v_begin_text:=CASE WHEN pg_catalog.jsonb_typeof(v_dates)='array' THEN v_dates->>0 ELSE v_dates#>>'{}' END;
        v_end_text:=CASE WHEN pg_catalog.jsonb_typeof(v_dates)='array' THEN coalesce(v_dates->>1,v_dates->>0) ELSE v_dates#>>'{}' END;
        IF v_begin_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND v_end_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
         v_local_start:=least(coalesce(v_local_start,v_begin_text::date),v_begin_text::date);
         v_local_end:=greatest(coalesce(v_local_end,v_end_text::date),v_end_text::date);
        END IF;
       END IF;
       v_rows:=v_rows||pg_catalog.jsonb_build_array(v_item||pg_catalog.jsonb_build_object('scope_id',v_scope.id));
      END LOOP;
      v_count:=v_count+pg_catalog.jsonb_array_length(v_part);
      IF v_count>50000 THEN RAISE EXCEPTION 'Group result too large' USING ERRCODE='54000'; END IF;

    END LOOP;
    IF v_type='culture' THEN
      IF v_local_start IS NULL THEN
       RETURN pg_catalog.jsonb_build_object('type',v_type,'scopes',v_scopes,'intersection',NULL,'rows','[]'::jsonb);
      END IF;
      v_start:=greatest(coalesce(v_start,v_local_start),v_local_start);
      v_end:=least(coalesce(v_end,v_local_end),v_local_end);
    END IF;
  END IF;
 END LOOP;
 IF v_type='culture' THEN
  IF pg_catalog.jsonb_array_length(v_scopes)=0 OR v_start>v_end OR v_start IS NULL
  THEN RETURN pg_catalog.jsonb_build_object('type',v_type,'scopes',v_scopes,'intersection',NULL,'rows','[]'::jsonb); END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(x.value),'[]'::jsonb) INTO v_part
  FROM pg_catalog.jsonb_array_elements(v_rows) x(value)
  WHERE CASE WHEN (x.value->'attr'->'date') IS NULL THEN false
       WHEN pg_catalog.jsonb_typeof(x.value->'attr'->'date')='array' THEN
        coalesce(x.value->'attr'->'date'->>0,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND coalesce(x.value->'attr'->'date'->>1,x.value->'attr'->'date'->>0,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND (x.value->'attr'->'date'->>0)::date<=v_end
        AND coalesce(x.value->'attr'->'date'->>1,x.value->'attr'->'date'->>0)::date>=v_start
       ELSE coalesce(x.value->'attr'->>'date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND (x.value->'attr'->>'date')::date BETWEEN v_start AND v_end END;
  RETURN pg_catalog.jsonb_build_object('type',v_type,'scopes',v_scopes,'intersection',pg_catalog.jsonb_build_object('start',v_start,'end',v_end),'rows',v_part);
 END IF;
 IF v_type='search' THEN
   RETURN pg_catalog.jsonb_build_object('type',v_type,'scopes',v_scopes);
 END IF;
 RETURN pg_catalog.jsonb_build_object('type',v_type,'scopes',v_scopes,'rows',v_rows);
END
$function$;

CREATE OR REPLACE FUNCTION silver.update_group_member_name(p_group_id text, p_member_id text, p_display_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_group text:=lower(btrim(coalesce(p_group_id,'')));
 v_member text:=lower(btrim(coalesce(p_member_id,'')));
 v_name text:=btrim(coalesce(p_display_name,''));
begin
 if not coalesce((SELECT allowed FROM silver.manage('group',v_group)),false) then
   raise exception 'group management permission denied';
 end if;
 if v_name='' or length(v_name)>120 then
   raise exception 'member display name must have 1-120 characters';
 end if;
 if not exists(select 1 from silver.manage m where m.id=v_member
     and m.parent_scope_id=v_group and m.manage_role='scope') then
   raise exception 'member is outside this group';
 end if;
 if to_regclass(format('silver.%I',v_member)) is null then
   raise exception 'member configuration is unavailable';
 end if;
 execute format('update silver.%I set display_name=$1,updated_at=now() where id=$2',
      v_member) using v_name,v_member;
 if not found then raise exception 'member configuration not updated'; end if;
 update silver.loc set display_name=v_name where id=v_member;
 return true;
end;
$function$;

CREATE OR REPLACE FUNCTION silver.sync_scope_config_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_TABLE_SCHEMA <> 'silver' OR NEW.id IS DISTINCT FROM TG_TABLE_NAME
     OR btrim(coalesce(NEW.display_name,''))='' THEN
    RAISE EXCEPTION 'Invalid Scope display_name sync target';
  END IF;
  UPDATE silver.loc
     SET display_name=btrim(NEW.display_name)
   WHERE id=NEW.id
     AND display_name IS DISTINCT FROM btrim(NEW.display_name);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION silver.read_app_bootstrap(p_scope_id text DEFAULT ''::text, p_page_name text DEFAULT 'index'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id text := lower(btrim(coalesce(p_scope_id, '')));
  v_page text := lower(btrim(coalesce(p_page_name, 'index')));
  v_config jsonb; v_blocks jsonb; v_table regclass; v_registry jsonb := '[]'::jsonb;
  v_name_sql text; v_names jsonb := '{}'::jsonb;
  v_theme_rows jsonb := '[]'::jsonb;
  v_loc_rows jsonb := '[]'::jsonb;
  v_page_copy jsonb := '[]'::jsonb;
  r record; r2 record;
begin
  if v_id !~ '^[a-z][a-z0-9]{0,14}$' then v_id := ''; end if;
  if v_page !~ '^[a-z0-9_-]+$' then v_page := 'index'; end if;

  -- One authoritative Scope metadata snapshot for this RPC execution.
  select coalesce(jsonb_agg(
    to_jsonb(m) || jsonb_build_object('display_name',l.display_name,
      'title_tw',l.title_tw,'desc_tw',l.desc_tw,'birthday',l.birthday)
    order by m.sort_order,m.id),'[]'::jsonb)
  into v_loc_rows from silver.manage m
  left join silver.loc l on l.id=m.id
  where m.manage_role IS DISTINCT FROM 'reserve';

  if v_id <> '' then
    v_table := to_regclass(format('silver.%I', v_id));
    if v_table is not null then
      if v_table = 'silver.loc'::regclass then
        select to_jsonb(t) - 'id' into v_config from silver.loc t where t.id=v_id;
      else
        execute format($q$select to_jsonb(t) - 'id' from %1$s t where t.id = $1$q$, v_table) into v_config using v_id;
      end if;
    end if;
    v_table := to_regclass(format('silver.%I', v_id || '_blocks'));
    if v_table is not null then
      execute format($q$
        select coalesce(jsonb_agg(to_jsonb(b) order by b.block_order), '[]'::jsonb)
        from (select uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image
              from %1$s where page_name = $1) b
      $q$, v_table) into v_blocks using v_page;
    end if;
  end if;

  -- LOC Group names come from its Scope rows, not per-scope dynamic SQL.
  select coalesce(jsonb_object_agg(obj->>'id',
    coalesce(nullif(obj->>'display_name',''),obj->>'id')),'{}'::jsonb)
  into v_names from jsonb_array_elements(v_loc_rows) as loc(obj);

  for r in
    select obj->>'id' as id, obj->>'manage_role' as role,
           obj->>'domain' as domain, obj->>'directory' as directory,
           obj->>'parent_scope_id' as parent_scope_id,
           (obj->>'active')::boolean as active,
           (obj->>'sort_order')::integer as sort_order
    from jsonb_array_elements(v_loc_rows) as loc(obj)
    where (obj->>'active')::boolean
    order by sort_order,id
  loop
    v_registry := v_registry || jsonb_build_array(jsonb_build_object(
      'scope_id', r.id, 'display_name', coalesce(v_names->>r.id, r.id),
      'scope_kind', case when r.role='group' then 'group' else 'scope' end,
      'domain', r.domain, 'directory', r.directory,
      'parent_scope_id', r.parent_scope_id, 'active', r.active, 'sort_order', r.sort_order));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'scope_id',obj->>'id','Title_TW',obj->>'title_tw','Desc_TW',obj->>'desc_tw'
    )),'[]'::jsonb) into v_page_copy
  from jsonb_array_elements(v_loc_rows) as loc(obj)
  where obj->>'manage_role' in ('group','scope')
    and (obj->>'active')::boolean;

  -- One JSONB catalog read, preserving both legacy response shapes.
  select l.theme into v_theme_rows from silver.loc l where l.id='loc';

  return jsonb_build_object(
    'scope_id', v_id, 'page_name', v_page, 'config', v_config, 'blocks', coalesce(v_blocks, '[]'::jsonb),
    'registry', v_registry,
    'page_copy', v_page_copy,
    'scope_birthdays', coalesce(
      (select jsonb_object_agg(s.id,to_char(s.birthday,'YYYY-MM-DD'))
         from silver.loc s where s.birthday IS NOT NULL),'{}'::jsonb),
    'theme_list', coalesce((select jsonb_agg(jsonb_build_object('theme_id', x.value->'theme_id', 'theme_name', x.value->'theme_name', 'theme_order', x.value->'theme_order') ORDER BY (x.value->>'theme_order')::int) FROM jsonb_array_elements(v_theme_rows) x(value)), '[]'::jsonb),
    'themes', coalesce(v_theme_rows, '[]'::jsonb)
  );
end;
$function$;

COMMIT;
