-- Replays the deployed lo3rwang Anchor cutover and repairs legacy RPC entry points.
-- The previous production migrations were applied through Supabase MCP.
-- No new tables, no new indexes: silver.lo3rwang_anchor already has B-tree(uid) and B-tree(type).
-- Other Scopes (including lrunes) keep their existing physical tables until separately cut over.
-- RESTRICT is intentional: never silently cascade-delete dependencies.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';

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
  v_source_class varchar(8);
  v_new_class varchar(4);
  v_keyword_count integer := 0;
  v_source_category record;
  v_source_class_row record;
  v_group record;
  v_item record;
  v_item_terms text[];
  v_new_category varchar(4);
  v_new_group varchar(4);
  v_new_item varchar(4);
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

  if to_regclass(format('silver.%I',v_config_name)) is not null
    or to_regclass(format('silver.%I',v_galaxy_name)) is not null
    or to_regclass(format('silver.%I',v_media_name)) is not null
    or to_regclass(format('silver.%I',v_time_name)) is not null
    or to_regclass(format('silver.%I',v_keywords_name)) is not null
    or to_regclass(format('silver.%I',v_blocks_name)) is not null
  then raise exception 'one or more Scope relations already exist'; end if;

  execute format('create table silver.%I (like silver.lo3rwang including all)',v_config_name);
  execute format('create trigger sync_scope_display_name after insert or update of display_name on silver.%I for each row execute function silver.sync_scope_config_display_name()',v_config_name);
  execute format('alter table silver.%I drop column if exists home_blocks',v_config_name);
  execute format('alter table silver.%I drop column if exists governance_blocks',v_config_name);
  execute format('create table silver.%I (like silver.lo3rwang_blocks including all)',v_blocks_name);
  execute format('create table silver.%I (like silver.lo3rwang_galaxy including all)',v_galaxy_name);
  execute format('create table silver.%I (like silver.lrunes_galaxy_media including all)',v_media_name);
  execute format('create table silver.%I (like silver.lrunes_time including all)',v_time_name);
  execute format('alter table silver.%I drop column if exists status',v_time_name);
  execute format('create table silver.%I (like silver.lrunes_keywords including all)',v_keywords_name);

  

  execute format('alter table silver.%I enable row level security',v_config_name);
  execute format('alter table silver.%I enable row level security',v_galaxy_name);
  execute format('alter table silver.%I enable row level security',v_media_name);
  execute format('alter table silver.%I enable row level security',v_time_name);
  execute format('alter table silver.%I enable row level security',v_keywords_name);
  execute format('alter table silver.%I enable row level security',v_blocks_name);

  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_config_public_read',v_config_name);
  execute format('create policy %I on silver.%I for update to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_config_scope_update',v_config_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_galaxy_public_read',v_galaxy_name);
  execute format('create policy %I on silver.%I for update to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_galaxy_scope_update',v_galaxy_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_media_public_read',v_media_name);
  execute format('create policy %I on silver.%I for update to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_media_scope_update',v_media_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_time_public_read',v_time_name);
  execute format('create policy %I on silver.%I for all to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_time_scope_all',v_time_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for all to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_keywords_scope_all',v_keywords_name,v_scope,v_scope);
  execute format('create policy %I on silver.%I for select to anonymous,authenticated using (true)',v_scope||'_blocks_public_read',v_blocks_name);
  execute format('create policy %I on silver.%I for all to authenticated using (silver.can_manage_scope(%L)) with check (silver.can_manage_scope(%L))',v_scope||'_blocks_scope_all',v_blocks_name,v_scope,v_scope);

  execute format('grant select on silver.%I to anonymous,authenticated',v_config_name);
  execute format('grant update on silver.%I to authenticated',v_config_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_galaxy_name);
  execute format('grant update on silver.%I to authenticated',v_galaxy_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_media_name);
  execute format('grant update on silver.%I to authenticated',v_media_name);
  execute format('grant select on silver.%I to anonymous,authenticated',v_time_name);
  execute format('grant select,insert,update,delete on silver.%I to authenticated',v_keywords_name);
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
    execute format('insert into silver.%I(uid,type,name,"desc") values($1,$2,$3,$4)',v_keywords_name)
      using v_new_category,'category',v_source_category.title,v_source_category.description;
    v_new_class:=silver.new_keyword_tree_uid(v_scope);
    execute format('insert into silver.%I(uid,type,name,"desc") values($1,$2,$3,$4)',v_keywords_name)
      using v_new_class,'class',v_source_class_row.title,v_source_class_row.description;
    execute format('update silver.%I set lists=ARRAY[$1]::text[] where uid=$2',v_keywords_name)
      using v_new_class,v_new_category;

    for v_group in select g.* from jsonb_array_elements_text(coalesce(v_source_class_row.attr->'uid','[]'::jsonb))
      with ordinality kid(uid,ord)
      join silver.lo3rwang_anchor g on g.uid=kid.uid and g.type='group'
      order by kid.ord
    loop
      v_new_group:=silver.new_keyword_tree_uid(v_scope);
      execute format('insert into silver.%I(uid,type,name,"desc") values($1,$2,$3,$4)',v_keywords_name)
        using v_new_group,'group',v_group.title,v_group.description;
      execute format('update silver.%I set lists=array_append(coalesce(lists,ARRAY[]::text[]),$1) where uid=$2',v_keywords_name)
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
        execute format('insert into silver.%I(uid,type,name,"desc",lists) values($1,$2,$3,$4,$5)',v_keywords_name)
          using v_new_item,'item',v_item.title,v_item.description,v_item_terms;
        execute format('update silver.%I set lists=array_append(coalesce(lists,ARRAY[]::text[]),$1) where uid=$2',v_keywords_name)
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

CREATE OR REPLACE FUNCTION silver.refresh_scoped_time_ranges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE tab text; q text;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
 IF TG_TABLE_SCHEMA<>'silver' OR TG_TABLE_NAME <> 'lrunes_time' THEN
   RAISE EXCEPTION 'Time scope not authorized';
 END IF;
 tab:=format('%I.%I',TG_TABLE_SCHEMA,TG_TABLE_NAME);

 q:=format($query$
 WITH projected AS (
   SELECT t.uid,jsonb_build_object(
   'version',1,
   'segments',CASE WHEN t.address IS NULL THEN '[]'::jsonb ELSE
     jsonb_build_array(jsonb_build_object(
       'index',0,'start_date',t.address::text,'end_date',t.address::text,
       'start_anchor_id',t.uid,'end_anchor_id',NULL,
       'anchor_ids',jsonb_build_array(t.uid),'point',true,'invalid',false,
       'open_end',false,'missing_anchor_ids','[]'::jsonb)) END,
   'invalid_period_uids','[]'::jsonb
 ) AS doc FROM %1$s t WHERE t.type='anchor'
 )
 UPDATE %1$s t SET "range"=p.doc FROM projected p
 WHERE t.uid=p.uid AND t."range" IS DISTINCT FROM p.doc
 $query$,tab);
 EXECUTE q;

 q:=format($query$
 WITH resolved AS (
   SELECT t.uid,t.anchor_ids,
     a1.address::text AS a_start,a2.address::text AS a_end,
     a1.uid AS found_start,a2.uid AS found_end,
     t.anchor_ids[1] AS ref_start,t.anchor_ids[2] AS ref_end
   FROM %1$s t
   LEFT JOIN %1$s a1 ON a1.uid=t.anchor_ids[1] AND a1.type='anchor'
   LEFT JOIN %1$s a2 ON a2.uid=t.anchor_ids[2] AND a2.type='anchor'
   WHERE t.type='period'
 ), projected AS (
   SELECT r.uid,
     jsonb_build_object('version',1,'invalid_period_uids','[]'::jsonb,
       'segments',CASE WHEN cardinality(r.anchor_ids)=0 THEN '[]'::jsonb ELSE
         jsonb_build_array(jsonb_build_object(
           'index',0,'anchor_ids',to_jsonb(r.anchor_ids),
           'start_anchor_id',r.ref_start,'end_anchor_id',r.ref_end,
           'start_date',coalesce(r.a_start,r.a_end),
           'end_date',CASE WHEN r.a_start IS NULL OR r.a_end IS NULL THEN
             coalesce(r.a_start,r.a_end) ELSE r.a_end END,
           'point',r.a_start IS NULL OR r.a_end IS NULL OR r.a_start=r.a_end,
           'invalid',(r.ref_start IS NOT NULL AND r.found_start IS NULL)
             OR (r.ref_end IS NOT NULL AND r.found_end IS NULL)
             OR (r.a_start IS NOT NULL AND r.a_end IS NOT NULL AND r.a_end<r.a_start)
             OR cardinality(r.anchor_ids)>2,
           'open_end',false,
           'missing_anchor_ids',
             (CASE WHEN r.ref_start IS NOT NULL AND r.found_start IS NULL THEN
               jsonb_build_array(r.ref_start) ELSE '[]'::jsonb END) ||
             (CASE WHEN r.ref_end IS NOT NULL AND r.found_end IS NULL THEN
               jsonb_build_array(r.ref_end) ELSE '[]'::jsonb END)
         )) END) AS doc
   FROM resolved r
 )
 UPDATE %1$s t SET "range"=p.doc FROM projected p
 WHERE t.uid=p.uid AND t."range" IS DISTINCT FROM p.doc
 $query$,tab);
 EXECUTE q;

 q:=format($query$
 WITH projected AS (
   SELECT t.uid,jsonb_build_object(
   'version',1,
   'segments',coalesce((
     SELECT jsonb_agg(z.doc ORDER BY z.link_order,z.segment_order)
     FROM (
       SELECT seg.value || jsonb_build_object(
         'index',(row_number() OVER (ORDER BY link.ord,seg.ord)-1)::integer,
         'period_uid',p.uid,'segment_order',(link.ord-1)::integer
       ) AS doc,link.ord AS link_order,seg.ord AS segment_order
       FROM unnest(t.anchor_ids) WITH ORDINALITY AS link(uid,ord)
       JOIN %1$s p ON p.uid=link.uid AND p.type='period'
       CROSS JOIN LATERAL jsonb_array_elements(p."range"->'segments') WITH ORDINALITY seg(value,ord)
     ) z
   ),'[]'::jsonb),
   'invalid_period_uids',coalesce((
      SELECT jsonb_agg(link.uid ORDER BY link.ord)
      FROM unnest(t.anchor_ids) WITH ORDINALITY link(uid,ord)
      LEFT JOIN %1$s p ON p.uid=link.uid AND p.type='period'
      WHERE p.uid IS NULL
   ),'[]'::jsonb)
 ) AS doc FROM %1$s t WHERE t.type='era'
 )
 UPDATE %1$s t SET "range"=p.doc FROM projected p
 WHERE t.uid=p.uid AND t."range" IS DISTINCT FROM p.doc
 $query$,tab);
 EXECUTE q;
 RETURN NULL;
END
$function$
;

DROP VIEW IF EXISTS api.lo3rwang_keywords_manage;
CREATE VIEW api.lo3rwang_keywords_manage WITH (security_invoker=true) AS
 SELECT uid,
    type,
    title AS name,
    description AS "desc",
    COALESCE(ARRAY( SELECT jsonb_array_elements_text(
                CASE
                    WHEN a.type = 'item'::text THEN COALESCE(a.attr -> 'keyword'::text, '[]'::jsonb)
                    ELSE COALESCE(a.attr -> 'uid'::text, '[]'::jsonb)
                END) AS jsonb_array_elements_text), ARRAY[]::text[]) AS lists,
        CASE
            WHEN type = ANY (ARRAY['group'::text, 'item'::text]) THEN jsonb_build_object('total', COALESCE((attr ->> 'total'::text)::integer, 0))
            ELSE '{}'::jsonb
        END AS uid_lists
   FROM silver.lo3rwang_anchor a
  WHERE (type = ANY (ARRAY['category'::text, 'class'::text, 'group'::text, 'item'::text])) AND silver.can_manage_scope('lo3rwang'::text);;
REVOKE ALL ON api.lo3rwang_keywords_manage FROM PUBLIC, anon;
GRANT SELECT ON api.lo3rwang_keywords_manage TO authenticated;

DROP TABLE IF EXISTS silver.lo3rwang_trace RESTRICT;
DROP TABLE IF EXISTS silver.lo3rwang_time RESTRICT;
DROP TABLE IF EXISTS silver.lo3rwang_galaxy_media RESTRICT;
DROP TABLE IF EXISTS silver.lo3rwang_keywords RESTRICT;

CREATE OR REPLACE FUNCTION silver.read_scope_analytics(p_scope_id text, p_view text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_mode text := lower(btrim(coalesce(p_view,'')));
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_result jsonb;
  v_galaxy regclass;
  v_media regclass;
  v_media_source text;
  v_from timestamptz;
  v_to timestamptz;
  v_places text[];
  v_class text;
  v_source text;
BEGIN
  IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR p_options IS NULL
    OR jsonb_typeof(p_options)<>'object' OR (p_start IS NOT NULL AND p_end IS NOT NULL AND p_start>p_end)
  THEN RAISE EXCEPTION 'Invalid unified statistics parameters' USING errcode='22023'; END IF;
  IF v_mode='loc' THEN
    IF v_scope<>'loc' THEN RAISE EXCEPTION 'Invalid LOC statistics scope' USING errcode='22023'; END IF;
    RETURN silver.read_loc_statistics(p_start,p_end);
  END IF;
  IF v_mode='daily' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.day,r.kind,r.category),'[]'::jsonb)
    INTO v_result FROM silver.read_scope_statistics(
      v_scope,p_start,p_end,coalesce((p_options->>'includeUndated')::boolean,false)) r;
    RETURN v_result;
  END IF;
  IF v_mode='overview' THEN
    RETURN silver.read_scope_overview(v_scope,p_start,p_end);
  END IF;
  IF v_mode='earliest' THEN
    RETURN to_jsonb(silver.read_scope_earliest(v_scope));
  END IF;
  IF v_mode='totals' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.kind,r.category),'[]'::jsonb)
      INTO v_result FROM silver.read_scope_category_totals(v_scope,p_start,p_end) r;
    RETURN v_result;
  END IF;
  v_class:=nullif(p_options->>'classUid','');
  v_source:=nullif(p_options->>'source','');
  IF v_mode='keyword_summary' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_result
    FROM silver.read_keyword_tree_summary(v_scope,p_start,p_end,v_source,v_class) r;
    RETURN v_result;
  END IF;
  IF v_mode='keyword_catalog' THEN
    RETURN silver.read_keyword_tree_catalog(v_scope,v_class);
  END IF;
  IF v_mode='shared_classes' THEN
    RETURN silver.read_shared_keyword_classes(v_scope);
  END IF;
  IF v_mode IN ('trace_daily','trace_keywords') THEN
    IF jsonb_typeof(p_options->'placeIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Trace place ID list required' USING errcode='22023'; END IF;
    SELECT array_agg(value) INTO v_places
      FROM jsonb_array_elements_text(p_options->'placeIds') AS t(value);
    IF v_places IS NULL OR cardinality(v_places) NOT BETWEEN 1 AND 80
       OR EXISTS(SELECT 1 FROM unnest(v_places) x WHERE ((v_scope='lo3rwang' AND x !~ '^[A-Za-z0-9]{8}$') OR (v_scope<>'lo3rwang' AND x !~ '^[A-Za-z0-9]{4}$'))) THEN
       RAISE EXCEPTION 'Invalid trace place IDs' USING errcode='22023'; END IF;
    IF v_mode='trace_daily' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_result
        FROM silver.read_trace_place_density(v_scope,v_places,p_start,p_end,v_source) r;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_result
        FROM silver.read_trace_keyword_group_totals(v_scope,v_places,p_start,p_end,v_source,v_class) r;
    END IF;
    RETURN v_result;
  END IF;
  RAISE EXCEPTION 'Unsupported statistics view' USING errcode='22023';
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_trace_place_density(p_scope_id text, p_place_ids text[], p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_source text DEFAULT NULL::text)
 RETURNS TABLE(day date, category text, item_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
BEGIN
 IF p_scope_id NOT IN ('lo3rwang','lrunes') THEN
   RAISE EXCEPTION 'Unsupported Trace article Scope';
 END IF;
 IF p_place_ids IS NULL OR cardinality(p_place_ids)=0 THEN RETURN; END IF;
 IF cardinality(p_place_ids)>80 OR EXISTS(
    SELECT 1 FROM unnest(p_place_ids) AS id
    WHERE id IS NULL OR ((p_scope_id='lo3rwang' AND id !~ '^[A-Za-z0-9]{8}$') OR (p_scope_id<>'lo3rwang' AND id !~ '^[A-Za-z0-9]{4}$'))
 ) THEN RAISE EXCEPTION 'Invalid Trace place IDs'; END IF;
 RETURN QUERY EXECUTE format($sql$
   SELECT (g.createtime AT TIME ZONE 'Asia/Taipei')::date AS day,
          g.place_id::text AS category,count(*)::bigint AS item_count
   FROM silver.%I AS g
   WHERE g.place_id=ANY($1) AND (g.able->>'trace')::boolean IS TRUE
     AND TRUE AND g.createtime IS NOT NULL
     AND ($2::date IS NULL OR g.createtime >=
       ($2::date::timestamp AT TIME ZONE 'Asia/Taipei'))
     AND ($3::date IS NULL OR g.createtime <
       (($3::date+1)::timestamp AT TIME ZONE 'Asia/Taipei'))
     AND ($4::text IS NULL OR g.site ILIKE $4)
   GROUP BY 1,2 ORDER BY 1,2
 $sql$,p_scope_id||'_galaxy')
 USING p_place_ids,p_start,p_end,p_source;
END;
$function$
;

CREATE OR REPLACE FUNCTION silver.apply_timeline_missing_places(p_scope_id text, p_updates jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE
  total integer;
  eligible integer;
  affected integer;
BEGIN
  IF nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL OR p_scope_id NOT IN ('lo3rwang','lrunes')
    OR NOT silver.can_manage_scope(p_scope_id) THEN
    RAISE EXCEPTION 'Timeline 寫入需要 Scope 管理權限' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid place batch';
  END IF;
  total := jsonb_array_length(p_updates);
  IF total NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION '每批只能補寫 1 至 10000 篇';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_updates)
      AS u(uid text,place_id text,expected_place_id text,manual boolean)
    WHERE u.uid IS NULL OR u.uid !~ '^[A-Za-z0-9]{8}$'
       OR u.place_id IS NULL OR u.place_id !~ ('^[A-Za-z0-9]{'||CASE WHEN p_scope_id='lo3rwang' THEN '8' ELSE '4' END||'}$')
       OR (u.expected_place_id IS NOT NULL AND u.expected_place_id <> u.place_id)
  ) THEN
    RAISE EXCEPTION '無效 UID／定錨點，或試圖覆寫原有 place_id';
  END IF;
  IF (SELECT count(DISTINCT uid) FROM jsonb_to_recordset(p_updates) AS u(uid text)) <> total THEN
    RAISE EXCEPTION '同批文章 UID 重複';
  END IF;
  -- Resolve only existing anchors inside the authorized Scope. Never use names from Timeline JSON.
  EXECUTE format($query$
    SELECT count(*)
      FROM jsonb_to_recordset($1) AS u(place_id text)
      JOIN silver.%I a ON a.uid = u.place_id AND %s
     WHERE length(btrim(a.title)) BETWEEN 1 AND 200
  $query$,CASE WHEN p_scope_id='lo3rwang' THEN 'lo3rwang_anchor' ELSE p_scope_id||'_trace' END,CASE WHEN p_scope_id='lo3rwang' THEN 'a.type=''point''' ELSE 'a.trace_type=''space_anchor''' END) INTO eligible USING p_updates;
  IF eligible <> total THEN
    RAISE EXCEPTION '部分地點不存在、名稱空白或超過 200 字，整批不寫入';
  END IF;
  -- Set-based UPDATE: one statement per batch, not 10000 separate SELECT + UPDATE loops.
  EXECUTE format($query$
    UPDATE silver.%I g
       SET location = btrim(a.title),
           place_id = COALESCE(NULLIF(btrim(g.place_id),''),u.place_id)
      FROM jsonb_to_recordset($1)
        AS u(uid text,place_id text,expected_place_id text,manual boolean)
      JOIN silver.%I a ON a.uid = u.place_id AND %s
     WHERE g.uid = u.uid
       AND NULLIF(btrim(g.place_id),'') IS NOT DISTINCT FROM u.expected_place_id
       AND (g.location IS NULL OR g.location ~ '^[[:space:]　]*$')
  $query$,p_scope_id||'_galaxy',CASE WHEN p_scope_id='lo3rwang' THEN 'lo3rwang_anchor' ELSE p_scope_id||'_trace' END,CASE WHEN p_scope_id='lo3rwang' THEN 'a.type=''point''' ELSE 'a.trace_type=''space_anchor''' END) USING p_updates;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> total THEN
    RAISE EXCEPTION '文章原有地點或 place_id 已改變，整批不寫入，請重新預覽';
  END IF;
  RETURN affected;
END
$function$
;

CREATE OR REPLACE FUNCTION silver.apply_timeline_place_ids(p_scope_id text, p_updates jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE
  total integer;
  eligible integer;
  affected integer;
BEGIN
  IF nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL OR p_scope_id NOT IN ('lo3rwang','lrunes')
    OR NOT silver.can_manage_scope(p_scope_id) THEN
    RAISE EXCEPTION 'Timeline 寫入需要 Scope 管理權限' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid place_id batch';
  END IF;
  total := jsonb_array_length(p_updates);
  IF total NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION '每批只能補寫 1 至 10000 篇';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_updates)
      AS u(uid text,place_id text,expected_place_id text,manual boolean)
    WHERE u.uid IS NULL OR u.uid !~ '^[A-Za-z0-9]{8}$'
       OR u.place_id IS NULL OR u.place_id !~ ('^[A-Za-z0-9]{'||CASE WHEN p_scope_id='lo3rwang' THEN '8' ELSE '4' END||'}$')
       OR u.expected_place_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'UID／place_id 格式或手動覆寫權限不正確';
  END IF;
  IF (SELECT count(DISTINCT uid) FROM jsonb_to_recordset(p_updates) AS u(uid text)) <> total THEN
    RAISE EXCEPTION '同批文章 UID 重複';
  END IF;
  EXECUTE format($query$
    SELECT count(*)
      FROM jsonb_to_recordset($1) AS u(place_id text)
      JOIN silver.%I a ON a.uid = u.place_id AND %s
  $query$,
    case when p_scope_id='lo3rwang' then 'lo3rwang_anchor' else p_scope_id||'_trace' end,
    case when p_scope_id='lo3rwang' then 'a.type=''point'''
         else 'a.trace_type=''space_anchor''' end
  ) INTO eligible USING p_updates;
  IF eligible <> total THEN
    RAISE EXCEPTION '存在不屬於此 Scope 的空間定錨點';
  END IF;
  EXECUTE format($query$
    UPDATE silver.%I g SET place_id = u.place_id
      FROM jsonb_to_recordset($1)
        AS u(uid text,place_id text,expected_place_id text,manual boolean)
     WHERE g.uid = u.uid AND NULLIF(btrim(g.place_id),'') IS NULL
  $query$,p_scope_id||'_galaxy') USING p_updates;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> total THEN
    RAISE EXCEPTION '文章的 place_id 已填寫或已變動，整批不寫入，請重新預覽';
  END IF;
  RETURN affected;
END
$function$
;

CREATE OR REPLACE FUNCTION silver.merge_scope_trace_place_names(p_scope_id text, p_keep_uid character varying, p_remove_uids character varying[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE table_name text; place_table text; count_matches integer; all_names text[]; remove_uid text;
BEGIN
 IF p_scope_id NOT IN ('lo3rwang','lrunes','loc') OR NOT silver.can_manage_scope(p_scope_id)
 THEN RAISE EXCEPTION '無權合併此 Scope 地點'; END IF;
 IF p_remove_uids IS NULL OR cardinality(p_remove_uids) NOT BETWEEN 1 AND 100
 OR p_keep_uid=ANY(p_remove_uids)
 OR cardinality(p_remove_uids)<>(SELECT count(DISTINCT id) FROM unnest(p_remove_uids) id)
 THEN RAISE EXCEPTION '地點清單無效或包含重複 UID'; END IF;

 -- Unified lo3rwang point merge: keep all UID8 links and move name aliases into attr.location.
 IF p_scope_id='lo3rwang' THEN
   IF p_keep_uid !~ '^[A-Za-z0-9]{8}$'
      OR EXISTS(SELECT 1 FROM unnest(p_remove_uids) x WHERE x !~ '^[A-Za-z0-9]{8}$') THEN
     RAISE EXCEPTION 'Invalid unified point UID';
   END IF;
   SELECT count(*) INTO count_matches FROM silver.lo3rwang_anchor
     WHERE type='point' AND (uid=p_keep_uid OR uid=ANY(p_remove_uids));
   IF count_matches<>cardinality(p_remove_uids)+1 THEN
     RAISE EXCEPTION '指定定錨點不存在或跨 Scope';
   END IF;
   IF EXISTS(SELECT 1 FROM silver.lo3rwang_anchor a
       WHERE a.type IN ('path','trace') AND jsonb_typeof(a.attr->'point')='array'
         AND (a.attr->'point') ? p_keep_uid AND (a.attr->'point') ?| p_remove_uids::text[]) THEN
     RAISE EXCEPTION '路線會重複指向同一點，請先調整路線';
   END IF;
   SELECT array_agg(DISTINCT name ORDER BY name) INTO all_names FROM (
     SELECT title::text AS name FROM silver.lo3rwang_anchor
       WHERE uid=p_keep_uid OR uid=ANY(p_remove_uids)
     UNION ALL
     SELECT jsonb_array_elements_text(CASE jsonb_typeof(attr->'location')
       WHEN 'array' THEN attr->'location'
       WHEN 'string' THEN jsonb_build_array(attr->>'location')
       ELSE '[]'::jsonb END)
       FROM silver.lo3rwang_anchor WHERE type='point'
         AND (uid=p_keep_uid OR uid=ANY(p_remove_uids))
   ) names WHERE nullif(btrim(name),'') IS NOT NULL;
   UPDATE silver.lo3rwang_anchor a SET attr=jsonb_set(a.attr,'{point}',
     (SELECT coalesce(jsonb_agg(
       CASE WHEN x.value=ANY(p_remove_uids) THEN to_jsonb(p_keep_uid::text)
            ELSE to_jsonb(x.value) END ORDER BY x.ord),'[]'::jsonb)
      FROM jsonb_array_elements_text(a.attr->'point') WITH ORDINALITY x(value,ord)),true)
    WHERE a.type IN ('path','trace') AND jsonb_typeof(a.attr->'point')='array'
      AND (a.attr->'point') ?| p_remove_uids::text[];
   -- Preserve article links instead of leaving dangling point UIDs.
   UPDATE silver.lo3rwang_galaxy SET place_id=p_keep_uid WHERE place_id=ANY(p_remove_uids);
   UPDATE silver.lo3rwang_anchor SET attr=jsonb_set(attr,'{location}',
      to_jsonb(coalesce(all_names,ARRAY[]::text[])),true)
     WHERE uid=p_keep_uid AND type='point';
   DELETE FROM silver.lo3rwang_anchor WHERE type='point' AND uid=ANY(p_remove_uids);
   GET DIAGNOSTICS count_matches=ROW_COUNT;
   IF count_matches<>cardinality(p_remove_uids) THEN RAISE EXCEPTION '合併筆數不一致'; END IF;
   RETURN count_matches;
 END IF;
 table_name:=p_scope_id||'_trace';place_table:=p_scope_id||'_place';
 EXECUTE format('SELECT count(*) FROM silver.%I WHERE trace_type=''space_anchor''
 AND (uid=$1 OR uid=ANY($2)) %s',
 table_name,CASE WHEN p_scope_id='loc' THEN 'AND scope_id=''loc''' ELSE '' END)
 INTO count_matches USING p_keep_uid,p_remove_uids;
 IF count_matches<>cardinality(p_remove_uids)+1 THEN RAISE EXCEPTION '指定定錨點不存在或跨 Scope'; END IF;
 EXECUTE format($sql$SELECT count(*) FROM silver.%I WHERE trace_type='path'
 AND anchor_list && $1::text[] AND $2=ANY(anchor_list) %s$sql$,table_name,
 CASE WHEN p_scope_id='loc' THEN 'AND scope_id=''loc''' ELSE '' END)
 INTO count_matches USING p_remove_uids::text[],p_keep_uid;
 IF count_matches>0 THEN RAISE EXCEPTION '路線會重複指向同一點，請先調整路線'; END IF;
 EXECUTE format($sql$SELECT array_agg(DISTINCT name ORDER BY name) FROM (
 SELECT title name FROM silver.%I WHERE uid=$1 OR uid=ANY($2)
 UNION ALL SELECT unnest(name_lists) FROM silver.%I WHERE uid=$1 OR uid=ANY($2)
 ) s WHERE nullif(btrim(name),'') IS NOT NULL$sql$,table_name,place_table)
 INTO all_names USING p_keep_uid,p_remove_uids;
 -- Spatial references are not article assignments. Do not change Galaxy.place_id.
 
FOREACH remove_uid IN ARRAY p_remove_uids LOOP
  EXECUTE format($sql$UPDATE silver.%I t SET
    anchor_list=array_replace(t.anchor_list,$1,$2),
    route_list=jsonb_set(t.route_list,'{segments}',
      coalesce((SELECT jsonb_agg(jsonb_build_array(
        CASE WHEN s.value->>0=$1 THEN $2 ELSE s.value->>0 END,
        CASE WHEN s.value->>1=$1 THEN $2 ELSE s.value->>1 END
      ) ORDER BY s.ord)
      FROM jsonb_array_elements(t.route_list->'segments') WITH ORDINALITY s(value,ord)),'[]'::jsonb))
    WHERE t.trace_type IN ('path','trace') AND $1=ANY(t.anchor_list) %s$sql$,
    table_name,CASE WHEN p_scope_id='loc' THEN 'AND scope_id=''loc''' ELSE '' END)
  USING remove_uid::text,p_keep_uid::text;
 END LOOP;

 EXECUTE format('INSERT INTO silver.%I(uid,name_lists) VALUES($1,$2)
 ON CONFLICT(uid) DO UPDATE SET name_lists=excluded.name_lists,updated_at=now()',place_table)
 USING p_keep_uid,coalesce(all_names,'{}'::text[]);
 EXECUTE format('DELETE FROM silver.%I WHERE uid=ANY($1) AND trace_type=''space_anchor'' %s',
   table_name,CASE WHEN p_scope_id='loc' THEN 'AND scope_id=''loc''' ELSE '' END)
 USING p_remove_uids;
 GET DIAGNOSTICS count_matches=ROW_COUNT;
 IF count_matches<>cardinality(p_remove_uids) THEN RAISE EXCEPTION '合併筆數不一致'; END IF;
 EXECUTE format('DELETE FROM silver.%I WHERE uid=ANY($1)',place_table) USING p_remove_uids;
 RETURN count_matches;
END $function$
;

CREATE OR REPLACE FUNCTION silver.save_scope_trace_place_names(p_scope_id text, p_uid character varying, p_names text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE exists_anchor boolean; saved_count integer; v_location jsonb; v_names text[];
BEGIN
 IF p_scope_id NOT IN ('lo3rwang','lrunes','loc') OR NOT silver.can_manage_scope(p_scope_id)
 THEN RAISE EXCEPTION 'No permission to manage Scope place names'; END IF;

 -- Unified lo3rwang names belong to point.attr.location, not the old UID4 place table.
 IF p_scope_id='lo3rwang' THEN
   IF p_uid !~ '^[A-Za-z0-9]{8}$' THEN RAISE EXCEPTION 'Invalid point UID'; END IF;
   IF p_names IS NULL OR cardinality(p_names)>250 THEN RAISE EXCEPTION 'Too many place name aliases'; END IF;
   SELECT attr->'location' INTO v_location FROM silver.lo3rwang_anchor
      WHERE uid=p_uid AND type='point' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Selected anchor UID does not exist in this Scope'; END IF;
   SELECT coalesce(array_agg(DISTINCT val ORDER BY val),ARRAY[]::text[]) INTO v_names
    FROM (
       SELECT jsonb_array_elements_text(CASE jsonb_typeof(v_location)
         WHEN 'array' THEN v_location WHEN 'string' THEN jsonb_build_array(v_location)
         ELSE '[]'::jsonb END) AS val
       UNION ALL SELECT btrim(name) AS val FROM unnest(p_names) name
    ) names WHERE nullif(btrim(val),'') IS NOT NULL AND char_length(val)<=320;
   UPDATE silver.lo3rwang_anchor SET attr=CASE
      WHEN cardinality(v_names)=0 THEN attr-'location'
      ELSE jsonb_set(attr,'{location}',to_jsonb(v_names),true) END
      WHERE uid=p_uid AND type='point';
   GET DIAGNOSTICS saved_count=ROW_COUNT;
   RETURN saved_count;
 END IF;
 IF p_scope_id='lo3rwang' THEN
   SELECT EXISTS(SELECT 1 FROM silver.lo3rwang_anchor WHERE type='point' AND uid=p_uid)
     INTO exists_anchor;
 ELSE
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM silver.%I WHERE uid=$1 AND trace_type=''space_anchor'' %s)',
  p_scope_id||'_trace',CASE WHEN p_scope_id='loc' THEN 'AND scope_id=''loc''' ELSE '' END)
  INTO exists_anchor USING p_uid;
 END IF;
 IF NOT exists_anchor THEN RAISE EXCEPTION 'Selected anchor UID does not exist in this Scope'; END IF;
 IF cardinality(p_names)>250 THEN RAISE EXCEPTION 'Too many place name aliases'; END IF;
 EXECUTE format('INSERT INTO silver.%I(uid,name_lists) VALUES ($1,$2)
 ON CONFLICT(uid) DO UPDATE SET name_lists=(
  SELECT ARRAY(SELECT DISTINCT name FROM unnest(
   silver.%I.name_lists || excluded.name_lists) name
   WHERE nullif(btrim(name),'''') IS NOT NULL ORDER BY name)
 ),updated_at=now()',p_scope_id||'_place',p_scope_id||'_place')
 USING p_uid,ARRAY(SELECT DISTINCT btrim(n) FROM unnest(p_names) n
  WHERE nullif(btrim(n),'') IS NOT NULL AND char_length(n)<=200 ORDER BY btrim(n));
 GET DIAGNOSTICS saved_count=ROW_COUNT;
 RETURN saved_count;
END $function$
;

CREATE OR REPLACE FUNCTION silver.search_scope_trace_place_names(p_scope_id text, p_term text, p_limit integer DEFAULT 8)
 RETURNS TABLE(uid character varying, title text, address double precision[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE term text; query text;
BEGIN
 IF p_scope_id NOT IN ('lo3rwang','lrunes','loc') OR nullif(btrim(p_term),'') IS NULL THEN RETURN; END IF;
 term:='%'||replace(replace(replace(left(btrim(p_term),100),'\\','\\\\'),'%','\\%'),'_','\\_')||'%';
 IF p_scope_id='lo3rwang' THEN
   RETURN QUERY
   SELECT a.uid::varchar,a.title::text,
      CASE WHEN (a.attr ? 'longitude') AND (a.attr ? 'latitude')
         THEN ARRAY[(a.attr->>'longitude')::double precision,(a.attr->>'latitude')::double precision]::double precision[]
         ELSE NULL::double precision[] END
   FROM silver.lo3rwang_anchor a
   WHERE a.type='point'
     AND (a.title ILIKE term OR EXISTS(SELECT 1 FROM
       jsonb_array_elements_text(CASE jsonb_typeof(a.attr->'location')
         WHEN 'array' THEN a.attr->'location'
         WHEN 'string' THEN jsonb_build_array(a.attr->>'location')
         ELSE '[]'::jsonb END) alias(name)
       WHERE alias.name ILIKE term))
   ORDER BY a.title,a.uid LIMIT least(greatest(coalesce(p_limit,8),1),8);
   RETURN;
 END IF;
 query:=format($sql$
 SELECT a.uid,a.title,a.address FROM silver.%I a
 LEFT JOIN silver.%I n ON n.uid=a.uid
 WHERE a.trace_type='space_anchor' %s
 AND (a.title ILIKE $1 OR EXISTS(SELECT 1 FROM unnest(coalesce(n.name_lists,'{}'::text[])) name WHERE name ILIKE $1))
 ORDER BY a.title,a.uid LIMIT $2
 $sql$,p_scope_id||'_trace',p_scope_id||'_place',
 CASE WHEN p_scope_id='loc' THEN 'AND a.scope_id=''loc''' ELSE '' END);
 RETURN QUERY EXECUTE query USING term,least(greatest(coalesce(p_limit,8),1),8);
END $function$
;

CREATE OR REPLACE FUNCTION silver.trace_place_suggestions(p_scope_id text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE target_rel text; suggestions jsonb;
BEGIN
 IF nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL OR p_scope_id IS NULL
    OR p_scope_id NOT IN ('lo3rwang','lrunes')
    OR NOT silver.can_manage_scope(p_scope_id) THEN
   RAISE EXCEPTION 'Scope management permission denied';
 END IF;
 IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
   RAISE EXCEPTION 'Invalid suggestion limit';
 END IF;
 target_rel := format('%I.%I','silver',p_scope_id||'_galaxy');
 EXECUTE format(
   'SELECT coalesce(jsonb_agg(to_jsonb(p)),''[]''::jsonb) FROM ('||
   ' SELECT btrim(location) AS name,COUNT(*)::int AS article_count'||
   ' FROM %s WHERE nullif(btrim(location),'''') IS NOT NULL'||
   ' GROUP BY btrim(location) ORDER BY COUNT(*) DESC,btrim(location) ASC LIMIT $1) p',
   target_rel
 ) INTO suggestions USING p_limit;
 RETURN suggestions;
END;$function$
;
COMMIT;
