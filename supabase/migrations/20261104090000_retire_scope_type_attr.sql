-- Retire silver.scope_type_attr. It had no RLS policy dependency and no app
-- .rpc() caller left (app/loc/providers/kysely-anchor.mjs already serves the
-- Anchor table via Kysely), but two other SQL functions still called it
-- directly: read_scope_analytics('keyword_catalog') and scope_group's
-- culture/trace aggregation. Both are rewritten here to stop depending on it
-- before it is dropped.
BEGIN;

-- Extracted from scope_type_attr's former op='catalog' branch.
CREATE OR REPLACE FUNCTION silver.scope_keyword_catalog(p_scope_id text, p_class_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_class text;
 v_current text;
 v_config regclass;
 v_keywords regclass;
 v_keywords_source text;
 v_result jsonb;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
    SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
    THEN RETURN '{}'::jsonb; END IF;
 v_config:=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope));
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope));
  v_keywords_source:=pg_catalog.format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=pg_catalog.to_regclass(pg_catalog.format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 IF v_config IS NULL OR v_keywords IS NULL THEN RETURN '{}'::jsonb; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN RETURN '{}'::jsonb; END IF;
 EXECUTE pg_catalog.format('SELECT current_keyword_class_uid FROM %s WHERE id=$1',v_config)
  INTO v_current USING v_scope;
 v_class:=coalesce(nullif(p_class_uid,''),v_current);
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN '{}'::jsonb; END IF;
 IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) AND
   NOT silver.keyword_class_is_shared(v_scope,v_class) THEN RETURN '{}'::jsonb; END IF;
 EXECUTE pg_catalog.format($query$
 WITH cl AS (SELECT uid,type,name,"desc",lists FROM %s WHERE uid=$1 AND type='class'),
 group_nodes AS (
  SELECT g.uid,g.type,g.name,g."desc",g.lists
  FROM cl CROSS JOIN LATERAL unnest(cl.lists) child(uid)
  JOIN %s g ON g.uid=child.uid AND g.type='group'
 ), item_nodes AS (
  SELECT i.uid,i.type,i.name,''::text AS "desc"
  FROM group_nodes g CROSS JOIN LATERAL unnest(g.lists) child(uid)
  JOIN %s i ON i.uid=child.uid AND i.type='item'
 ), members AS (
  SELECT uid,type,name,"desc",lists FROM cl
  UNION ALL SELECT uid,type,name,"desc",lists FROM group_nodes
  UNION ALL SELECT uid,type,name,"desc",'{}'::text[] FROM item_nodes
 )
 SELECT jsonb_build_object('class_uid',$1,'rows',coalesce(
  jsonb_agg(jsonb_build_object('uid',uid,'type',type,'name',name,'desc',"desc",
    'lists',lists,'uid_lists','[]'::jsonb)),'[]'::jsonb))
 FROM members
 $query$,v_keywords_source,v_keywords_source,v_keywords_source) INTO v_result USING v_class;
 RETURN coalesce(v_result,'{}'::jsonb);
END
$function$;

-- read_scope_analytics('keyword_catalog') now calls scope_keyword_catalog
-- directly instead of routing through scope_type_attr.
CREATE OR REPLACE FUNCTION silver.read_scope_analytics(p_scope_id text, p_view text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
  IF v_mode='search_summary' THEN
    IF v_scope<>'loc' OR p_start IS NOT NULL OR p_end IS NOT NULL OR
       pg_catalog.jsonb_typeof(p_options->'scopeIds') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Invalid Scope Search summary request' USING ERRCODE='22023'; END IF;
    SELECT array_agg(value) INTO v_places
      FROM pg_catalog.jsonb_array_elements_text(p_options->'scopeIds') AS t(value);
    RETURN silver.read_scope_search_summary(coalesce(v_places,ARRAY[]::text[]));
  END IF;
  IF v_mode='trace_places' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.day,r.category),'[]'::jsonb)
      INTO v_result FROM silver.read_scope_place_statistics(v_scope,p_start,p_end) r;
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
    RETURN silver.scope_keyword_catalog(v_scope,v_class);
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
       OR EXISTS(SELECT 1 FROM unnest(v_places) x WHERE ((pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL AND x !~ '^[A-Za-z0-9]{8}$') OR (pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NULL AND x !~ '^[A-Za-z0-9]{4}$'))) THEN
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
$function$;

-- scope_group's culture/trace aggregation now reads {scope}_anchor directly
-- instead of paging through scope_type_attr.
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
  SELECT m.id,m.display_name,m.anchor_table FROM silver.manage m
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
     v_offset:=0;
     LOOP
      -- Public anchor-table read, equivalent to the retired
      -- scope_type_attr(v_scope.id, v_kind, {op:'read', limit:500, offset:v_offset}).
      EXECUTE pg_catalog.format($q$
        SELECT coalesce(pg_catalog.jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
        (SELECT uid,type,title,description,invisible,attr
         FROM silver.%I WHERE type=$1 AND ($2 OR invisible IS FALSE)
         ORDER BY uid LIMIT 500 OFFSET $3) x
      $q$,v_relation) INTO v_part USING v_kind,v_owner,v_offset;
      EXIT WHEN pg_catalog.jsonb_array_length(v_part)=0;
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
      EXIT WHEN pg_catalog.jsonb_array_length(v_part)<500;
      v_offset:=v_offset+500;
      EXIT WHEN v_offset>100000;
     END LOOP;
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

-- scope_type_attr: no RLS policy dependency, no app .rpc() caller, and (after
-- the two rewrites above) no other SQL function calls it either.
DROP FUNCTION silver.scope_type_attr(text,text,jsonb) RESTRICT;

NOTIFY pgrst,'reload schema';
COMMIT;
