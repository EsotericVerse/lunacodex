BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
-- Scope creation/deletion use native Anchor. Existing uid/type B-trees only.
-- lrunes_daily is independent; never create, alter or drop it here.
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
  if not silver.can_manage_global() then raise exception 'global management permission denied'; end if;
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
  IF NOT silver.can_manage_global() THEN
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
COMMIT;
