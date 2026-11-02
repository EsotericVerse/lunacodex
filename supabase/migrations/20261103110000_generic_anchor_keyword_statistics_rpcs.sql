BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.keyword_class_is_shared(p_scope_id text, p_class_uid text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_config regclass;
 v_meta jsonb;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
    OR p_class_uid !~ (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '^[A-Za-z0-9]{8}$' ELSE '^[A-Za-z0-9]{4}$' END) THEN RETURN false; END IF;
 v_config:=to_regclass(format('silver.%I',v_scope));
 IF v_config IS NULL THEN RETURN false; END IF;
 EXECUTE format('SELECT keyword_meta FROM %s WHERE id=$1',v_config)
   INTO v_meta USING v_scope;
 RETURN coalesce((v_meta->'class_shares'->>p_class_uid)::boolean,false);
END
$function$
;
CREATE OR REPLACE FUNCTION silver.read_keyword_tree_catalog(p_scope_id text, p_class_uid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
 v_public boolean:=false;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
    SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
    THEN RETURN '{}'::jsonb; END IF;
 v_config:=to_regclass(format('silver.%I',v_scope));
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 IF v_config IS NULL OR v_keywords IS NULL THEN RETURN '{}'::jsonb; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN RETURN '{}'::jsonb; END IF;
 EXECUTE format('SELECT current_keyword_class_uid FROM %s WHERE id=$1',v_config)
  INTO v_current USING v_scope;
 v_class:=coalesce(nullif(p_class_uid,''),v_current);
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN '{}'::jsonb; END IF;
 IF NOT silver.can_manage_scope(v_scope) AND
   NOT silver.keyword_class_is_shared(v_scope,v_class) THEN RETURN '{}'::jsonb; END IF;
 EXECUTE format($query$
 WITH cl AS (SELECT uid,type,name,"desc",lists FROM %s WHERE uid=$1 AND type='class'),
 group_nodes AS (
  SELECT g.uid,g.type,g.name,g."desc",g.lists
  FROM cl CROSS JOIN LATERAL unnest(cl.lists) child(uid)
  JOIN %s g ON g.uid=child.uid AND g.type='group'
 ), item_nodes AS (
  -- Item descriptions can contain unpublished rules and private meanings.
  -- Public catalog needs only the UID and label for Culture/Statistics.
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
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION silver.read_shared_keyword_classes(p_scope_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_keywords regclass;
 v_keywords_source text;
 v_result jsonb;
 v_owner boolean;
 v_class_source text;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
   SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
   THEN RETURN '[]'::jsonb; END IF;
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 IF v_keywords IS NULL THEN RETURN '[]'::jsonb; END IF;
 v_owner:=silver.can_manage_scope(v_scope);
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN
   v_class_source:=format('(SELECT uid::text AS uid,name FROM %s WHERE type=''class'')',v_keywords_source);
 ELSIF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='class_uid' AND attnum>0 AND NOT attisdropped) THEN
   -- Legacy Neon: Class UID exists, but the UID-linked Group/Item tree does not.
   v_class_source:=format('(SELECT DISTINCT ON (class_uid) class_uid::text AS uid,class_name AS name
     FROM %s WHERE class_uid IS NOT NULL ORDER BY class_uid,class_name)',v_keywords_source);
 ELSE RETURN '[]'::jsonb; END IF;
 EXECUTE format($query$
   SELECT coalesce(jsonb_agg(jsonb_build_object(
     'scopeId',$1,
     'classUid',c.uid,
     'name',c.name,
     'category',CASE WHEN $2 THEN c.uid::text
       ELSE encode(sha256(convert_to($1||':'||c.uid::text,'UTF8')),'hex') END
   ) ORDER BY c.uid),'[]'::jsonb)
   FROM %s c WHERE ($2 OR silver.keyword_class_is_shared($1,c.uid::text))
 $query$,v_class_source) INTO v_result USING v_scope,v_owner;
 RETURN coalesce(v_result,'[]'::jsonb);
END
$function$
;
COMMIT;
