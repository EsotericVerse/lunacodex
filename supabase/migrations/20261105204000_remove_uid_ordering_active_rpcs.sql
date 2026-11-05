-- Later migration supersedes historical UID-sorted RPC bodies without rewriting applied migrations.
-- UID is an opaque Base62 identity, never an ORDER BY field.
-- Preserve original privileges, security modes, argument signatures, and return types.

CREATE OR REPLACE FUNCTION silver.preview_or_fill_galaxy_place(p_scope_id text, p_start_date date, p_end_date date, p_place text, p_apply boolean DEFAULT false, p_expected_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_rel text;
  start_at timestamptz;
  end_before timestamptz;
  missing_count integer;
  affected_count integer;
  first_sample jsonb := '[]'::jsonb;
  last_sample jsonb := '[]'::jsonb;
  place_label text := btrim(coalesce(p_place,''));
  predicate text;
BEGIN
  IF api.current_user_id() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL OR p_scope_id IS NULL
     OR NOT coalesce((SELECT allowed FROM silver.manage('scope',p_scope_id)),false) THEN
    RAISE EXCEPTION 'Scope management permission denied';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL
     OR p_start_date > p_end_date
     OR p_start_date < DATE '1900-01-01'
     OR p_end_date >= DATE '2100-01-01' THEN
    RAISE EXCEPTION 'Complete and ordered start/end dates required';
  END IF;
  IF place_label = '' OR length(place_label) > 200 THEN
    RAISE EXCEPTION 'Place name must be 1 to 200 characters';
  END IF;
  IF p_apply IS NULL THEN RAISE EXCEPTION 'Apply flag is required'; END IF;
  target_rel := format('%I.%I','silver',p_scope_id||'_galaxy');
  start_at := p_start_date::timestamp AT TIME ZONE 'Asia/Taipei';
  end_before := (p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Taipei';
  predicate := 'createtime >= $1 AND createtime < $2 AND NULLIF(btrim(location),'''') IS NULL';
  EXECUTE format('SELECT COUNT(*) FROM %s WHERE %s',target_rel,predicate)
    INTO missing_count USING start_at,end_before;

  IF p_apply THEN
    IF p_expected_count IS NULL OR p_expected_count < 1
       OR p_expected_count <> missing_count THEN
      RAISE EXCEPTION 'Preview is stale; refresh the preview before writing';
    END IF;
    EXECUTE format('UPDATE %s SET location=$3 WHERE %s',target_rel,predicate)
      USING start_at,end_before,place_label;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    IF affected_count <> p_expected_count THEN
      RAISE EXCEPTION 'Matched record count changed; transaction rolled back';
    END IF;
    RETURN jsonb_build_object('count',affected_count,'applied',true);
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s)),''[]''::jsonb) FROM ('||
    ' SELECT btrim(uid::text) AS uid, coalesce(title,'''') AS title,'||
    ' to_char(createtime AT TIME ZONE ''Asia/Taipei'',''YYYY-MM-DD'') AS date'||
    ' FROM %s WHERE %s ORDER BY createtime ASC LIMIT 3) s',
    target_rel,predicate)
    INTO first_sample USING start_at,end_before;
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s)),''[]''::jsonb) FROM ('||
    ' SELECT btrim(uid::text) AS uid, coalesce(title,'''') AS title,'||
    ' to_char(createtime AT TIME ZONE ''Asia/Taipei'',''YYYY-MM-DD'') AS date'||
    ' FROM %s WHERE %s ORDER BY createtime DESC LIMIT 3) s',
    target_rel,predicate)
    INTO last_sample USING start_at,end_before;
  RETURN jsonb_build_object('count',missing_count,'first',first_sample,'last',last_sample,'applied',false);
END;
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
 v_owner:=coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false);
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
   ) ORDER BY c.name),'[]'::jsonb)
   FROM %s c WHERE ($2 OR silver.keyword_class_is_shared($1,c.uid::text))
 $query$,v_class_source) INTO v_result USING v_scope,v_owner;
 RETURN coalesce(v_result,'[]'::jsonb);
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_trace_keyword_group_totals(p_scope_id text, p_place_ids text[], p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_source text DEFAULT NULL::text, p_class_uid text DEFAULT NULL::text)
 RETURNS TABLE(group_uid text, group_name text, document_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
  v_config regclass;
  v_galaxy regclass;
  v_keywords regclass;
 v_keywords_source text;
  v_class_uid text;
  v_current text;
  v_meta jsonb;
  v_old_ready timestamptz;
  v_ready timestamptz;
  v_public boolean:=false;
BEGIN
  IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR
     NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
     THEN RAISE EXCEPTION 'Invalid Scope'; END IF;
  IF p_place_ids IS NULL OR cardinality(p_place_ids)<1 OR cardinality(p_place_ids)>80
    THEN RAISE EXCEPTION 'Place UID list must have 1-80 items'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_place_ids) x WHERE x !~ ('^[0-9A-Za-z]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$'))
    THEN RAISE EXCEPTION 'Invalid Place UID'; END IF;
  v_config:=to_regclass(format('silver.%I',v_scope));
  v_galaxy:=to_regclass(format('silver.%I_galaxy',v_scope));
  IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
  IF v_config IS NULL OR v_galaxy IS NULL OR v_keywords IS NULL
    THEN RAISE EXCEPTION 'Missing Scope data'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped)
    THEN RETURN; END IF;
  EXECUTE format('SELECT current_keyword_class_uid,keyword_meta,staticstime FROM %s WHERE id=$1',v_config)
    INTO v_current,v_meta,v_old_ready USING v_scope;
  v_class_uid:=coalesce(nullif(p_class_uid,''),v_current);
  IF v_class_uid IS NULL OR v_class_uid !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN; END IF;
  IF v_meta->'by_class'->v_class_uid->>'completedAt' IS NOT NULL THEN
    v_ready:=(v_meta->'by_class'->v_class_uid->>'completedAt')::timestamptz;
  ELSIF v_class_uid=v_current AND v_meta->>'class_uid'=v_class_uid THEN
    v_ready:=v_old_ready;
  END IF;
  IF v_ready IS NULL THEN RETURN; END IF;
  IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) AND
    NOT silver.keyword_class_is_shared(v_scope,v_class_uid) THEN RETURN; END IF;
  RETURN QUERY EXECUTE format($query$
    WITH cl AS (
      SELECT uid,lists FROM %1$s WHERE type='class' AND uid=$1
    ), groups AS (
      SELECT g.uid,g.name,g.uid_lists
      FROM cl c
      CROSS JOIN LATERAL unnest(c.lists) cid(value)
      JOIN %1$s g ON g.uid=cid.value AND g.type='group'
    ), articles AS MATERIALIZED (
      SELECT g.uid::text uid
      FROM %2$s g
      WHERE g.place_id=ANY($2) AND (g.keyword)::boolean IS TRUE
        AND TRUE
        AND ($3 IS NULL OR g.date >= $3)
        AND ($4 IS NULL OR g.date <= $4)
        AND ($5 IS NULL OR g.site=$5)
    )
    SELECT k.uid::text,k.name,count(DISTINCT a.uid)::bigint
    FROM groups k
    LEFT JOIN articles a ON (coalesce(k.uid_lists->'uidlists',k.uid_lists->'articles','[]'::jsonb)) ? a.uid
    GROUP BY k.uid,k.name
    ORDER BY k.name
  $query$,v_keywords_source,v_galaxy)
  USING v_class_uid,p_place_ids,p_start,p_end,nullif(p_source,'');
END
$function$
;

CREATE OR REPLACE FUNCTION silver.rename_scope_site_batch(p_scope_id text, p_before text, p_after text, p_batch_size integer DEFAULT 1000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_galaxy regclass; v_affected integer;
BEGIN
  IF api.current_user_id() IS NULL OR coalesce(p_scope_id,'') !~ '^[a-z][a-z0-9]{0,14}$'
    OR NOT coalesce((SELECT allowed FROM silver.manage('scope',p_scope_id)),false) THEN
    RAISE EXCEPTION 'Scope source correction permission denied';
  END IF;
  IF p_before IS NULL OR p_after IS NULL OR btrim(p_before)='' OR btrim(p_after)=''
    OR length(btrim(p_before))>80 OR length(btrim(p_after))>80
    OR btrim(p_before)=btrim(p_after) THEN
    RAISE EXCEPTION 'Invalid source name correction';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>1000 THEN
    RAISE EXCEPTION 'Invalid batch size';
  END IF;
  v_galaxy:=to_regclass(format('silver.%I',p_scope_id||'_galaxy'));
  IF v_galaxy IS NULL THEN RAISE EXCEPTION 'Unknown Scope Galaxy'; END IF;
  EXECUTE format($sql$
    WITH targets AS (
      SELECT uid FROM %1$s WHERE site=$1 LIMIT $3 FOR UPDATE SKIP LOCKED
    )
    UPDATE %1$s AS galaxy SET site=$2 FROM targets WHERE galaxy.uid=targets.uid
  $sql$,v_galaxy)
    USING btrim(p_before),btrim(p_after),p_batch_size;
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  RETURN v_affected;
END;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION silver.search_scope_trace_place_names(p_scope_id text, p_term text, p_limit integer DEFAULT 8)
 RETURNS TABLE(uid character varying, title text, address double precision[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_anchor regclass;v_term text;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR nullif(btrim(p_term),'') IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active) THEN RETURN; END IF;
 v_anchor:=to_regclass(format('silver.%I_anchor',v_scope));
 IF v_anchor IS NULL THEN RETURN; END IF;
 v_term:='%'||replace(replace(replace(left(btrim(p_term),100),'\','\\'),'%','\%'),'_','\_')||'%';
 RETURN QUERY EXECUTE format($q$
 SELECT a.uid::varchar,a.title::text,
 CASE WHEN a.attr ? 'longitude' AND a.attr ? 'latitude'
 THEN ARRAY[(a.attr->>'longitude')::double precision,(a.attr->>'latitude')::double precision]::double precision[]
 ELSE NULL::double precision[] END
 FROM %s a WHERE a.type='point' AND NOT a.invisible
 AND (a.title ILIKE $1 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(
 CASE jsonb_typeof(a.attr->'location')
 WHEN 'array' THEN a.attr->'location' WHEN 'string' THEN jsonb_build_array(a.attr->>'location')
 ELSE '[]'::jsonb END) alias(name) WHERE alias.name ILIKE $1))
 ORDER BY a.title LIMIT $2 $q$,v_anchor)
 USING v_term,least(greatest(coalesce(p_limit,8),1),8);
END $function$
;
