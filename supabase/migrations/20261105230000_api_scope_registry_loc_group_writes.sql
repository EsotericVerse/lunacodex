-- Legacy RPC write compatibility: manage controls Routing/role;
-- LOC Group owns name/title/description/birthday records.
-- No RLS/GRANT/POLICY edits (existing per-new-Scope provisioning left intact).
BEGIN;
SET LOCAL statement_timeout='90s';
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
      id,domain,directory,parent_scope_id,active,sort_order,manage_role
    ) values(
      v_scope,nullif(v_domain,''),nullif(v_directory,''),v_parent,v_active,v_sort,'group'
    )
    returning * into v_current;
    insert into silver.loc(id,display_name,locale)
    values(v_scope,v_name,'zh-Hant');

  elsif v_operation='update' then
    select * into v_current from silver.manage where id=v_scope;
    if not found then raise exception 'Scope registry row not found'; end if;
    if v_current.manage_role='system' then
      raise exception 'system registry rows are immutable';
    end if;

    v_name := case when v_values ? 'display_name'
      then btrim(coalesce(v_values->>'display_name',''))
      else (select l.display_name from silver.loc l where l.id=v_scope) end;
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
    set domain=nullif(v_domain,''),
        directory=nullif(v_directory,''),
        parent_scope_id=nullif(v_parent,''),
        active=v_active,
        sort_order=v_sort
    where id=v_scope
    returning * into v_current;
    update silver.loc set display_name=v_name where id=v_scope;
    if not found then raise exception 'LOC Group Scope List record not found'; end if;
  else
    raise exception 'unsupported Scope Registry operation';
  end if;

  return jsonb_build_object(
    'scope_id',v_current.id,
    'display_name',v_name,
    'scope_kind',case when v_current.manage_role='group' then 'group' when v_current.manage_role='system' then 'system' else 'scope' end,
    'domain',v_current.domain,
    'directory',v_current.directory,
    'parent_scope_id',v_current.parent_scope_id,
    'active',v_current.active,
    'sort_order',v_current.sort_order
  );
end;
$function$;

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
  execute format('create policy %I on silver.%I for update to authenticated using (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false)) with check (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_config_scope_update',v_config_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_galaxy_public_read',v_galaxy_name);
  execute format('create policy %I on silver.%I for update to authenticated using (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false)) with check (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_galaxy_scope_update',v_galaxy_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (type IN (''date'',''period'',''era'',''point'',''path'',''trace'',''image'',''video'',''rune'',''suno'') AND invisible IS FALSE)',v_scope||'_anchor_public_read',v_anchor_name);
  execute format('create policy %I on silver.%I for select to authenticated using (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_anchor_owner_read',v_anchor_name,v_scope);
  execute format('create policy %I on silver.%I for insert to authenticated with check (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_anchor_owner_insert',v_anchor_name,v_scope);
  execute format('create policy %I on silver.%I for update to authenticated using (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false)) with check (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_anchor_owner_update',v_anchor_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for delete to authenticated using (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_anchor_owner_delete',v_anchor_name,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_blocks_public_read',v_blocks_name);
  execute format('create policy %I on silver.%I for all to authenticated using (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false)) with check (coalesce((SELECT allowed FROM silver.manage(''scope'',%L)),false))',v_scope||'_blocks_scope_all',v_blocks_name,v_scope,v_scope);

  execute format('grant select on silver.%I to anonymous,authenticated',v_config_name);
  execute format('grant update on silver.%I to authenticated',v_config_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_galaxy_name);
  execute format('grant update on silver.%I to authenticated',v_galaxy_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_anchor_name);
  execute format('grant insert,update,delete on silver.%I to authenticated',v_anchor_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_blocks_name);
  execute format('grant insert,update,delete on silver.%I to authenticated',v_blocks_name);

  select coalesce(max(sort_order),0)+10 into v_sort_order from silver.manage where parent_scope_id=v_parent;
  insert into silver.manage(id,domain,directory,parent_scope_id,active,sort_order,email,manage_role)
  values(v_scope,nullif(v_domain,''),nullif(v_directory,''),v_parent,true,v_sort_order,v_email,'scope');

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
      (id,email,display_name,search_intro,search_aliases,theme,locale,search,
       statics,culture,trace,keyword_min_chars,keyword_min_documents,
       current_keyword_class_uid,keyword_class_share_enabled,keyword_meta,staticstime,updated_at)
     values($1,$2,$3,'''',array[$1,$3]::text[],$4,''zh-Hant'',
       true,true,true,true,32,100,$5,false,''{}''::jsonb,null,now())',
    v_config_name
  ) using v_scope,v_email,v_name,v_theme,v_new_class;

  insert into silver.loc(id,display_name,locale,birthday)
  values(v_scope,v_name,'zh-Hant',p_birthday);

  perform pg_catalog.pg_notify('pgrst','reload schema');

  return jsonb_build_object(
    'scope_id',v_scope,'display_name',v_name,'parent_scope_id',v_parent,
    'route_mode',case when v_domain<>'' then 'domain' else 'directory' end,
    'route_value',case when v_domain<>'' then v_domain else v_directory end,
    'keyword_rows',v_keyword_count,'keyword_class_uid',v_new_class
  );
end;
$function$;
COMMIT;
