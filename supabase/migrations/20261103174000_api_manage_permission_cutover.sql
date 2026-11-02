-- The API schema also uses unified management; keep procedure signatures and behavior.
BEGIN;
CREATE OR REPLACE FUNCTION api.manage_scope_registry(p_operation text, p_scope_id text, p_values jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_operation text := lower(btrim(coalesce(p_operation,'')));
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_values jsonb := coalesce(p_values,'{}'::jsonb);
  v_current silver.manage%rowtype;
  v_name text;
  v_domain text;
  v_directory text;
  v_parent text;
  v_active boolean;
  v_sort integer;
  v_cycle boolean := false;
begin
  if not coalesce((SELECT allowed FROM silver.manage('global')),false) then
    raise exception 'global management permission denied';
  end if;
  if v_scope !~ '^[a-z][a-z0-9]{0,14}$' then
    raise exception 'Scope ID must be 1-15 lowercase alphanumeric characters and start with a letter';
  end if;
  if jsonb_typeof(v_values) <> 'object' then
    raise exception 'values must be an object';
  end if;

  if v_operation='create_group' then
    if exists(select 1 from silver.manage where id=v_scope) then
      raise exception 'Scope registry ID already exists';
    end if;

    v_name := btrim(coalesce(v_values->>'display_name',''));
    v_domain := lower(btrim(coalesce(v_values->>'domain','')));
    v_directory := lower(btrim(coalesce(v_values->>'directory','')));
    v_parent := lower(btrim(coalesce(v_values->>'parent_scope_id','loc')));
    v_active := coalesce((v_values->>'active')::boolean,true);

    if v_name='' then raise exception 'display name is required'; end if;
    if (v_domain='')=(v_directory='') then
      raise exception 'exactly one of domain or directory is required';
    end if;
    if v_domain<>'' and v_domain !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' then
      raise exception 'domain format is invalid';
    end if;
    if v_directory<>'' then
      v_directory := '/'||btrim(v_directory,'/');
      if btrim(v_directory,'/') !~ '^[a-z0-9][a-z0-9/_-]*$' then
        raise exception 'directory format is invalid';
      end if;
    end if;
    if not exists(
      select 1 from silver.manage
      where id=v_parent and manage_role='group' and active
    ) then
      raise exception 'parent Scope Group does not exist or is inactive';
    end if;
    if v_values ? 'sort_order' then
      v_sort := coalesce((v_values->>'sort_order')::integer,0);
    else
      select coalesce(max(sort_order),0)+10 into v_sort
      from silver.manage where parent_scope_id=v_parent;
    end if;

    insert into silver.manage(
      id,display_name,domain,directory,parent_scope_id,active,sort_order,manage_role
    ) values(
      v_scope,v_name,nullif(v_domain,''),nullif(v_directory,''),v_parent,v_active,v_sort,'group'
    )
    returning * into v_current;

  elsif v_operation='update' then
    select * into v_current from silver.manage where id=v_scope;
    if not found then raise exception 'Scope registry row not found'; end if;
    if v_current.manage_role='system' then
      raise exception 'system registry rows are immutable';
    end if;

    v_name := case when v_values ? 'display_name'
      then btrim(coalesce(v_values->>'display_name',''))
      else v_current.display_name end;
    v_domain := case when v_values ? 'domain'
      then lower(btrim(coalesce(v_values->>'domain','')))
      else coalesce(v_current.domain,'') end;
    v_directory := case when v_values ? 'directory'
      then lower(btrim(coalesce(v_values->>'directory','')))
      else coalesce(v_current.directory,'') end;
    v_parent := case when v_values ? 'parent_scope_id'
      then lower(btrim(coalesce(v_values->>'parent_scope_id','')))
      else coalesce(v_current.parent_scope_id,'') end;
    v_active := case when v_values ? 'active'
      then coalesce((v_values->>'active')::boolean,false)
      else v_current.active end;
    v_sort := case when v_values ? 'sort_order'
      then coalesce((v_values->>'sort_order')::integer,0)
      else v_current.sort_order end;

    if v_name='' then raise exception 'display name is required'; end if;
    if (v_domain='')=(v_directory='') then
      raise exception 'exactly one of domain or directory is required';
    end if;
    if v_domain<>'' and v_domain !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' then
      raise exception 'domain format is invalid';
    end if;
    if v_directory<>'' then
      v_directory := '/'||btrim(v_directory,'/');
      if btrim(v_directory,'/') !~ '^[a-z0-9][a-z0-9/_-]*$' then
        raise exception 'directory format is invalid';
      end if;
    end if;

    if v_scope='loc' then
      if v_parent<>'' then raise exception 'root LOC group cannot have a parent'; end if;
      if not v_active then raise exception 'root LOC group cannot be disabled'; end if;
    else
      if v_parent='' then raise exception 'non-root registry rows require a parent Scope Group'; end if;
      if v_parent=v_scope then raise exception 'Scope cannot parent itself'; end if;
      if not exists(
        select 1 from silver.manage
        where id=v_parent and manage_role='group' and active
      ) then
        raise exception 'parent Scope Group does not exist or is inactive';
      end if;
    end if;

    if v_current.manage_role='group' and v_parent<>'' then
      with recursive ancestors(id,parent_scope_id) as (
        select r.id,r.parent_scope_id
        from silver.manage r where r.id=v_parent
        union all
        select r.id,r.parent_scope_id
        from silver.manage r
        join ancestors a on r.id=a.parent_scope_id
        where a.parent_scope_id is not null
      )
      select exists(select 1 from ancestors where id=v_scope) into v_cycle;
      if v_cycle then raise exception 'Scope Group parent would create a cycle'; end if;
    end if;

    if v_current.manage_role='group' and not v_active and exists(
      select 1 from silver.manage where parent_scope_id=v_scope and active
    ) then
      raise exception 'move or disable active child Scopes before disabling this Group';
    end if;

    update silver.manage
    set display_name=v_name,
        domain=nullif(v_domain,''),
        directory=nullif(v_directory,''),
        parent_scope_id=nullif(v_parent,''),
        active=v_active,
        sort_order=v_sort,
        updated_at=now()
    where id=v_scope
    returning * into v_current;
  else
    raise exception 'unsupported Scope Registry operation';
  end if;

  return jsonb_build_object(
    'scope_id',v_current.id,
    'display_name',v_current.display_name,
    'scope_kind',case when v_current.manage_role='group' then 'group' when v_current.manage_role='system' then 'system' else 'scope' end,
    'domain',v_current.domain,
    'directory',v_current.directory,
    'parent_scope_id',v_current.parent_scope_id,
    'active',v_current.active,
    'sort_order',v_current.sort_order
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION api.move_scope_block(p_scope_id text, p_page_name text, p_uid text, p_direction integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_page text := lower(btrim(coalesce(p_page_name,'')));
  v_uid text := btrim(coalesce(p_uid,''));
  v_table regclass;
  v_order integer;
  v_neighbor_uid text;
  v_neighbor_order integer;
  v_count integer;
BEGIN
  IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' THEN RAISE EXCEPTION 'Invalid Scope ID'; END IF;
  IF v_page='' OR length(v_page)>80 THEN RAISE EXCEPTION 'Invalid page name'; END IF;
  IF v_uid !~ '^[A-Za-z0-9]{8}$' THEN RAISE EXCEPTION 'Invalid block UID'; END IF;
  IF p_direction NOT IN (-1,1) OR p_direction IS NULL THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  IF NOT (
    CASE WHEN v_scope='loc' THEN (coalesce((SELECT allowed FROM silver.manage('global')),false) OR (v_page='index' AND silver.can_manage_group('loc')))
    ELSE silver.can_manage_scope(v_scope) END
  ) THEN RAISE EXCEPTION 'Scope management permission denied'; END IF;
  v_table := to_regclass(format('silver.%I',v_scope||'_blocks'));
  IF v_table IS NULL THEN RAISE EXCEPTION 'Scope Blocks table not found'; END IF;
  -- Serialise swaps of any two blocks on the same page.
  PERFORM pg_advisory_xact_lock(hashtext(v_scope),hashtext(v_page));
  EXECUTE format('SELECT block_order FROM %s WHERE uid=$1 AND page_name=$2',v_table)
    INTO v_order USING v_uid,v_page;
  IF v_order IS NULL THEN RAISE EXCEPTION 'Block not found on requested page'; END IF;
  IF p_direction=-1 THEN
    EXECUTE format('SELECT uid::text,block_order FROM %s
      WHERE page_name=$1 AND block_order<$2 ORDER BY block_order DESC,uid DESC LIMIT 1',v_table)
      INTO v_neighbor_uid,v_neighbor_order USING v_page,v_order;
  ELSE
    EXECUTE format('SELECT uid::text,block_order FROM %s
      WHERE page_name=$1 AND block_order>$2 ORDER BY block_order ASC,uid ASC LIMIT 1',v_table)
      INTO v_neighbor_uid,v_neighbor_order USING v_page,v_order;
  END IF;
  IF v_neighbor_uid IS NULL THEN RAISE EXCEPTION 'Block is already at page boundary'; END IF;
  EXECUTE format('UPDATE %s SET block_order=CASE WHEN uid=$1 THEN $3 ELSE $4 END
                  WHERE page_name=$5 AND uid IN ($1,$2)',v_table)
    USING v_uid,v_neighbor_uid,v_neighbor_order,v_order,v_page;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>2 THEN RAISE EXCEPTION 'Block reorder incomplete: % rows',v_count; END IF;
  RETURN jsonb_build_object('uid',v_uid,'block_order',v_neighbor_order,'neighbor_uid',v_neighbor_uid,'neighbor_order',v_order);
END;
$function$
;
CREATE OR REPLACE FUNCTION api.provision_scope(p_scope_id text, p_display_name text, p_email text, p_birthday date DEFAULT NULL::date, p_domain text DEFAULT NULL::text, p_directory text DEFAULT NULL::text, p_parent_scope_id text DEFAULT 'loc'::text, p_theme text DEFAULT 'system-default'::text, p_copy_keywords boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_name text := btrim(coalesce(p_display_name,''));
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_domain text := lower(btrim(coalesce(p_domain,'')));
  v_directory text := lower(btrim(coalesce(p_directory,'')));
  v_parent text := lower(btrim(coalesce(p_parent_scope_id,'loc')));
  v_theme text := lower(btrim(coalesce(p_theme,'system-default')));
  v_config_name text;
  v_galaxy_name text;
  v_media_name text;
  v_time_name text;
  v_keywords_name text;
  v_blocks_name text;
  v_anchor_name text;
  v_source_class varchar(8);
  v_new_class varchar(8);
  v_keyword_count integer := 0;
  v_source_category record;
  v_source_class_row record;
  v_group record;
  v_item record;
  v_item_terms text[];
  v_new_category varchar(8);
  v_new_group varchar(8);
  v_new_item varchar(8);
  v_sort_order integer := 0;
begin
  if not coalesce((SELECT allowed FROM silver.manage('global')),false) then raise exception 'global management permission denied'; end if;
  if v_scope !~ '^[a-z][a-z0-9]{0,14}$' then raise exception 'Scope ID must be 1-15 lowercase alphanumeric characters and start with a letter'; end if;
  if v_name='' then raise exception 'display name is required'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'email format is invalid'; end if;
  if v_theme<>'system-default' and v_theme !~ '^theme-[1-8]$' then raise exception 'theme must be theme-1 through theme-8'; end if;
  if (v_domain='') = (v_directory='') then raise exception 'exactly one of domain or directory is required'; end if;
  if v_domain<>'' and v_domain !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' then raise exception 'domain format is invalid'; end if;
  if v_directory<>'' then
    v_directory := '/'||btrim(v_directory,'/');
    if btrim(v_directory,'/') !~ '^[a-z0-9][a-z0-9/_-]*$' then raise exception 'directory format is invalid'; end if;
  end if;
  if v_parent='' then v_parent := 'loc'; end if;
  if not exists(select 1 from silver.manage where id=v_parent and manage_role='group' and active)
  then raise exception 'parent Scope Group does not exist or is inactive'; end if;
  if exists(select 1 from silver.manage where id=v_scope)
  then raise exception 'Scope already exists'; end if;
  if v_domain<>'' and exists(select 1 from silver.manage where lower(domain)=v_domain)
  then raise exception 'domain already belongs to another Scope'; end if;
  if v_directory<>'' and exists(select 1 from silver.manage where lower(directory)=v_directory)
  then raise exception 'directory already belongs to another Scope'; end if;

  v_config_name := v_scope;
  v_galaxy_name := v_scope||'_galaxy';
  v_media_name := v_scope||'_galaxy_media';
  v_time_name := v_scope||'_time';
  v_keywords_name := v_scope||'_keywords';
  v_blocks_name := v_scope||'_blocks';
  v_anchor_name := v_scope||'_anchor';

  if to_regclass(format('silver.%I',v_config_name)) is not null
    or to_regclass(format('silver.%I',v_galaxy_name)) is not null
    or to_regclass(format('silver.%I',v_media_name)) is not null
    or to_regclass(format('silver.%I',v_time_name)) is not null
    or to_regclass(format('silver.%I',v_keywords_name)) is not null
    or to_regclass(format('silver.%I',v_blocks_name)) is not null
    or to_regclass(format('silver.%I',v_anchor_name)) is not null
  then raise exception 'one or more Scope relations already exist'; end if;

  execute format('create table silver.%I (like silver.lo3rwang including all)',v_config_name);
  execute format('create trigger sync_scope_display_name after insert or update of display_name on silver.%I for each row execute function silver.sync_scope_config_display_name()',v_config_name);
  execute format('alter table silver.%I drop column if exists home_blocks',v_config_name);
  execute format('alter table silver.%I drop column if exists governance_blocks',v_config_name);
  execute format('create table silver.%I (like silver.lo3rwang_blocks including all)',v_blocks_name);
  execute format('create table silver.%I (like silver.lo3rwang_galaxy including all)',v_galaxy_name);
  -- One universal Anchor replaces four individually provisioned metadata tables.
  -- LIKE INCLUDING ALL reuses only the standard UID/type B-tree indexes.
  execute format('create table silver.%I (like silver.lrunes_anchor including all)',v_anchor_name);

  

  execute format('alter table silver.%I enable row level security',v_config_name);
  execute format('alter table silver.%I enable row level security',v_galaxy_name);
  execute format('alter table silver.%I enable row level security',v_anchor_name);
  execute format('alter table silver.%I enable row level security',v_blocks_name);

  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_config_public_read',v_config_name);
  execute format('create policy %I on silver.%I for update to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_config_scope_update',v_config_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_galaxy_public_read',v_galaxy_name);
  execute format('create policy %I on silver.%I for update to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_galaxy_scope_update',v_galaxy_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (type IN (''date'',''period'',''era'',''point'',''path'',''trace'',''image'',''video'',''rune'',''suno'') AND invisible IS FALSE)',v_scope||'_anchor_public_read',v_anchor_name);
  execute format('create policy %I on silver.%I for select to authenticated using (silver.can_manage_scope(%L))',v_scope||'_anchor_owner_read',v_anchor_name,v_scope);
  execute format('create policy %I on silver.%I for insert to authenticated with check (silver.can_manage_scope(%L))',v_scope||'_anchor_owner_insert',v_anchor_name,v_scope);
  execute format('create policy %I on silver.%I for update to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_anchor_owner_update',v_anchor_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for delete to authenticated using (silver.can_manage_scope(%L))',v_scope||'_anchor_owner_delete',v_anchor_name,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_blocks_public_read',v_blocks_name);
  execute format('create policy %I on silver.%I for all to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_blocks_scope_all',v_blocks_name,v_scope,v_scope);

  execute format('grant select on silver.%I to anonymous,authenticated',v_config_name);
  execute format('grant update on silver.%I to authenticated',v_config_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_galaxy_name);
  execute format('grant update on silver.%I to authenticated',v_galaxy_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_anchor_name);
  execute format('grant insert,update,delete on silver.%I to authenticated',v_anchor_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_blocks_name);
  execute format('grant insert,update,delete on silver.%I to authenticated',v_blocks_name);

  select coalesce(max(sort_order),0)+10 into v_sort_order from silver.manage where parent_scope_id=v_parent;
  insert into silver.manage(id,display_name,domain,directory,parent_scope_id,active,sort_order,email,manage_role,birthday)
  values(v_scope,v_name,nullif(v_domain,''),nullif(v_directory,''),v_parent,true,v_sort_order,v_email,'scope',p_birthday);

  v_new_class := null;
  if p_copy_keywords then
    select current_keyword_class_uid into v_source_class
      from silver.lo3rwang where id='lo3rwang';
    if v_source_class is null then raise exception 'No default Class configured'; end if;
    select * into v_source_class_row
      from silver.lo3rwang_anchor where uid=v_source_class and type='class';
    if v_source_class_row.uid is null then raise exception 'Source Class does not exist'; end if;
    select c.* into v_source_category from silver.lo3rwang_anchor c
      where c.type='category' and (c.attr->'uid') ? v_source_class limit 1;
    if v_source_category.uid is null then raise exception 'Source Category does not exist'; end if;

    v_new_category:=silver.new_keyword_tree_uid(v_scope);
    execute format('insert into silver.%I(uid,type,title,description,attr) values($1,''category'',$2,$3,jsonb_build_object(''uid'',''[]''::jsonb))',v_anchor_name)
      using v_new_category,v_source_category.title,v_source_category.description;
    v_new_class:=silver.new_keyword_tree_uid(v_scope);
    execute format('insert into silver.%I(uid,type,title,description,attr) values($1,''class'',$2,$3,jsonb_build_object(''uid'',''[]''::jsonb))',v_anchor_name)
      using v_new_class,v_source_class_row.title,v_source_class_row.description;
    execute format('update silver.%I set attr=jsonb_set(attr,''{uid}'',jsonb_build_array($1::text),true) where uid=$2',v_anchor_name)
      using v_new_class,v_new_category;

    for v_group in select g.* from jsonb_array_elements_text(coalesce(v_source_class_row.attr->'uid','[]'::jsonb))
      with ordinality kid(uid,ord)
      join silver.lo3rwang_anchor g on g.uid=kid.uid and g.type='group'
      order by kid.ord
    loop
      v_new_group:=silver.new_keyword_tree_uid(v_scope);
      execute format('insert into silver.%I(uid,type,title,description,attr) values($1,''group'',$2,$3,jsonb_build_object(''uid'',''[]''::jsonb,''total'',0))',v_anchor_name)
        using v_new_group,v_group.title,v_group.description;
      execute format('update silver.%I set attr=jsonb_set(attr,''{uid}'',coalesce(attr->''uid'',''[]''::jsonb)||jsonb_build_array($1::text),true) where uid=$2',v_anchor_name)
        using v_new_group,v_new_class;

      for v_item in select i.* from jsonb_array_elements_text(coalesce(v_group.attr->'uid','[]'::jsonb))
        with ordinality kid(uid,ord)
        join silver.lo3rwang_anchor i on i.uid=kid.uid and i.type='item'
        order by kid.ord
      loop
        v_new_item:=silver.new_keyword_tree_uid(v_scope);
        SELECT coalesce(array_agg(j.value ORDER BY j.ord),ARRAY[]::text[]) INTO v_item_terms
          FROM jsonb_array_elements_text(coalesce(v_item.attr->'keyword','[]'::jsonb))
          WITH ORDINALITY AS j(value,ord);
        execute format('insert into silver.%I(uid,type,title,description,attr) values($1,''item'',$2,$3,jsonb_build_object(''keyword'',to_jsonb($4::text[]),''total'',0))',v_anchor_name)
          using v_new_item,v_item.title,v_item.description,v_item_terms;
        execute format('update silver.%I set attr=jsonb_set(attr,''{uid}'',coalesce(attr->''uid'',''[]''::jsonb)||jsonb_build_array($1::text),true) where uid=$2',v_anchor_name)
          using v_new_item,v_new_group;
        v_keyword_count:=v_keyword_count+1;
      end loop;
    end loop;
  end if;

  execute format(
    'insert into silver.%I
      (id,email,display_name,search_intro,search_aliases,theme,locale,search_able,
       statistics_able,culture_able,keyword_min_chars,keyword_min_documents,
       current_keyword_class_uid,keyword_class_share_enabled,keyword_meta,staticstime,updated_at)
     values($1,$2,$3,'''',array[$1,$3]::text[],$4,''zh-Hant'',
       true,true,true,32,100,$5,false,''{}''::jsonb,null,now())',
    v_config_name
  ) using v_scope,v_email,v_name,v_theme,v_new_class;

  perform pg_catalog.pg_notify('pgrst','reload schema');

  return jsonb_build_object(
    'scope_id',v_scope,'display_name',v_name,'parent_scope_id',v_parent,
    'route_mode',case when v_domain<>'' then 'domain' else 'directory' end,
    'route_value',case when v_domain<>'' then v_domain else v_directory end,
    'keyword_rows',v_keyword_count,'keyword_class_uid',v_new_class
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION api.delete_scope(p_scope_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_role text;
  v_suffix text;
  v_relation text;
BEGIN
  IF NOT coalesce((SELECT allowed FROM silver.manage('global')),false) THEN
    RAISE EXCEPTION 'Global Admin permission required';
  END IF;
  IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' THEN
    RAISE EXCEPTION 'invalid Scope ID';
  END IF;
  IF v_scope IN ('loc','lrunes','lo3rwang','admin') THEN
    RAISE EXCEPTION 'Cannot delete a built-in Scope';
  END IF;
  SELECT manage_role INTO v_role FROM silver.manage
  WHERE id=v_scope FOR UPDATE;
  IF NOT FOUND OR v_role<>'scope' THEN
    RAISE EXCEPTION 'Only an existing non-system Scope may be deleted';
  END IF;
  IF EXISTS(SELECT 1 FROM silver.manage WHERE parent_scope_id=v_scope) THEN
    RAISE EXCEPTION 'Scope has child Registry entries';
  END IF;
  -- Existing Scope installations may still use the old four-table layout;
  -- fresh ones use only Anchor, Galaxy, Blocks and config.
  IF to_regclass(format('silver.%I_anchor',v_scope)) IS NULL
     AND to_regclass(format('silver.%I_keywords',v_scope)) IS NULL THEN
    RAISE EXCEPTION 'Scope metadata relation missing';
  END IF;
  FOREACH v_suffix IN ARRAY ARRAY[
    '_anchor','_galaxy_media','_trace','_time','_keywords','_place',
    '_galaxy','_blocks',''
  ] LOOP
    v_relation:=format('silver.%I',v_scope||v_suffix);
    IF to_regclass(v_relation) IS NOT NULL THEN
      EXECUTE 'DROP TABLE '||v_relation||' RESTRICT';
    ELSIF v_suffix IN ('_galaxy','_blocks','') THEN
      RAISE EXCEPTION 'Expected Scope relation missing: %',v_relation;
    END IF;
  END LOOP;
  DELETE FROM silver.manage WHERE id=v_scope;
  RETURN jsonb_build_object('scope_id',v_scope,'deleted',true);
END;
$function$
;
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
   v_allowed := silver.can_manage_group('loc');
 else
   for v_scope in
     select id,coalesce(nullif(galaxy_table,''),'galaxy') as galaxy,coalesce(nullif(anchor_table,''),'anchor') as anchor
     from silver.manage
   loop
     if not silver.can_manage_scope(v_scope.id) then continue; end if;
     if v_rel = to_regclass(format('silver.%I',v_scope.id))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_'||v_scope.galaxy))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_'||v_scope.galaxy||'_media'))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_'||v_scope.anchor))
       or v_rel = to_regclass(format('silver.%I',v_scope.id||'_blocks'))
     then
       v_allowed := true;
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
;
COMMIT;