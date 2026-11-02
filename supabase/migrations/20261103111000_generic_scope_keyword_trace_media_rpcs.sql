BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.import_shared_keyword_class(p_target_scope text, p_source_scope text, p_class_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_to text:=lower(btrim(coalesce(p_target_scope,'')));
 v_from text:=lower(btrim(coalesce(p_source_scope,'')));
 v_uid text:=coalesce(p_class_uid,'');
 v_source regclass;
 v_source_sql text;
 v_target regclass;
 v_class record;
 v_group record;
 v_item record;
 v_group_link record;
 v_item_link record;
 v_root text;
 v_group_uid text;
 v_item_uid text;
 v_group_ids text[]:='{}'::text[];
 v_item_ids text[];
 v_group_count int:=0;
 v_item_count int:=0;
BEGIN
 IF v_to !~ '^[a-z][a-z0-9]{0,14}$'
    OR v_from !~ '^[a-z][a-z0-9]{0,14}$'
    OR v_uid !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_from)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN
   RAISE EXCEPTION 'Invalid Scope or Class UID' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM silver.manage
   WHERE id=v_to AND manage_role='scope' AND active)
   OR NOT EXISTS(SELECT 1 FROM silver.manage
   WHERE id=v_from AND manage_role='scope' AND active) THEN
   RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='22023';
 END IF;
 IF NOT silver.can_manage_scope(v_to) THEN
   RAISE EXCEPTION 'Target Scope management permission required' USING ERRCODE='42501';
 END IF;
 IF NOT silver.keyword_class_is_shared(v_from,v_uid) THEN
   RAISE EXCEPTION 'Source Class is not publicly shared' USING ERRCODE='42501';
 END IF;
 v_source:=CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_from)) IS NOT NULL THEN to_regclass(format('silver.%I_anchor',v_from))
   ELSE to_regclass(format('silver.%I_keywords',v_from)) END;
 v_source_sql:=CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_from)) IS NOT NULL
   THEN format('(SELECT uid,type,title AS name,description AS "desc",ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists,invisible FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_from)
   ELSE v_source::text END;
 v_target:=CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL THEN to_regclass(format('silver.%I_anchor',v_to))
   ELSE to_regclass(format('silver.%I_keywords',v_to)) END;
 IF v_source IS NULL OR v_target IS NULL THEN
   RAISE EXCEPTION 'Keywords table unavailable' USING ERRCODE='22023';
 END IF;
 EXECUTE format('SELECT uid,name,"desc",lists,invisible FROM %s WHERE uid=$1 AND type=$2',v_source_sql)
   INTO v_class USING v_uid,'class';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Only an existing Class UID may be imported' USING ERRCODE='22023';
 END IF;
 -- A concurrent import to the same target cannot allocate conflicting UIDs.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_to),17148);
 FOR v_group_link IN SELECT unnest(v_class.lists) AS uid LOOP
   EXECUTE format('SELECT uid,name,"desc",lists,invisible FROM %s WHERE uid=$1 AND type=$2',v_source_sql)
     INTO v_group USING v_group_link.uid,'group';
   IF NOT FOUND THEN
     RAISE EXCEPTION 'Source Class references an invalid Group' USING ERRCODE='22023';
   END IF;
   v_item_ids:='{}'::text[];
   FOR v_item_link IN SELECT unnest(v_group.lists) AS uid LOOP
     EXECUTE format('SELECT uid,name,"desc",lists,invisible FROM %s WHERE uid=$1 AND type=$2',v_source_sql)
       INTO v_item USING v_item_link.uid,'item';
     IF NOT FOUND THEN
       RAISE EXCEPTION 'Source Group references an invalid Item' USING ERRCODE='22023';
     END IF;
     v_item_uid:=silver.new_keyword_tree_uid(v_to);
     EXECUTE (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
       USING v_item_uid,'item',v_item.name,v_item."desc",v_item.lists,CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL THEN '{"total":0,"uidlists":[]}'::jsonb ELSE '{"hits":[]}'::jsonb END,v_item.invisible;
     v_item_ids:=array_append(v_item_ids,v_item_uid);
     v_item_count:=v_item_count+1;
   END LOOP;
   v_group_uid:=silver.new_keyword_tree_uid(v_to);
   EXECUTE (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
     USING v_group_uid,'group',v_group.name,v_group."desc",v_item_ids,CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL THEN '{"total":0,"uidlists":[]}'::jsonb ELSE '{"articles":[]}'::jsonb END,v_group.invisible;
   v_group_ids:=array_append(v_group_ids,v_group_uid);
   v_group_count:=v_group_count+1;
 END LOOP;
 v_root:=silver.new_keyword_tree_uid(v_to);
 EXECUTE (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
   USING v_root,'class',v_class.name,v_class."desc",v_group_ids,'{}'::jsonb,v_class.invisible;
 -- Deliberately no Category insert: Category is owned by Scope Group.
 RETURN jsonb_build_object('scopeid',v_to,'uid',v_root,
   'source_scopeid',v_from,'source_uid',v_uid,
   'group_count',v_group_count,'item_count',v_item_count);
END
$function$
;
CREATE OR REPLACE FUNCTION silver.read_keyword_tree_summary(p_scope_id text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_source text DEFAULT NULL::text, p_class_uid text DEFAULT NULL::text)
 RETURNS TABLE(kind text, item_key text, group_uid text, day text, hit_count bigint, document_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_config regclass;
 v_keywords regclass;
 v_keywords_source text;
 v_galaxy regclass;
 v_class text;
 v_current text;
 v_meta jsonb;
 v_old_done timestamptz;
 v_done timestamptz;
 v_public boolean:=false;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
   SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
   THEN RAISE EXCEPTION 'Invalid Scope'; END IF;
 v_config:=to_regclass(format('silver.%I',v_scope));
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 v_galaxy:=to_regclass(format('silver.%I_galaxy',v_scope));
 IF v_config IS NULL OR v_keywords IS NULL OR v_galaxy IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN RETURN; END IF;
 EXECUTE format('SELECT current_keyword_class_uid,keyword_meta,staticstime FROM %s WHERE id=$1',v_config)
 INTO v_current,v_meta,v_old_done USING v_scope;
 v_class:=coalesce(nullif(p_class_uid,''),v_current);
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN; END IF;
 IF v_meta->'by_class'->v_class->>'completedAt' IS NOT NULL THEN
   v_done:=(v_meta->'by_class'->v_class->>'completedAt')::timestamptz;
 ELSIF v_class=v_current AND v_meta->>'class_uid'=v_class THEN
   v_done:=v_old_done;
 END IF;
 IF v_done IS NULL THEN RETURN; END IF;
 IF NOT silver.can_manage_scope(v_scope) AND
   NOT silver.keyword_class_is_shared(v_scope,v_class) THEN RETURN; END IF;
 RETURN QUERY EXECUTE format($query$
   WITH clazz AS (SELECT uid,lists FROM %1$s WHERE type='class' AND uid=$1),
   groups AS MATERIALIZED (
     SELECT g.uid::text AS uid,g.name,g.lists,g.uid_lists,c.order_no
     FROM clazz
     CROSS JOIN LATERAL unnest(clazz.lists) WITH ORDINALITY c(uid,order_no)
     JOIN %1$s g ON g.uid=c.uid AND g.type='group'
   ), items AS MATERIALIZED (
     SELECT i.uid::text AS uid,g.uid::text AS group_uid,i.uid_lists
     FROM groups g
     CROSS JOIN LATERAL unnest(g.lists) iid(uid)
     JOIN %1$s i ON i.uid=iid.uid AND i.type='item'
   ), group_hits AS MATERIALIZED (
     SELECT g.uid AS group_uid,article.uid::text AS article_uid,article.date::text AS d
     FROM groups g
     CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(g.uid_lists->'uidlists',g.uid_lists->'articles','[]'::jsonb)) a(uid)
     JOIN %2$s article ON article.uid::text=a.uid
     WHERE (article.able->>'keywords')::boolean IS TRUE
      AND ($2 IS NULL OR article.date >= $2) AND ($3 IS NULL OR article.date <= $3)
      AND ($4 IS NULL OR article.site=$4)
   ), item_hits AS MATERIALIZED (
     SELECT i.uid AS item_uid,i.group_uid,article.uid::text AS article_uid,
       article.date::text AS d,CASE WHEN jsonb_typeof(h.entry)='string' THEN 1 ELSE (h.entry->>'times')::bigint END AS times, (i.uid_lists->>'total')::bigint AS total
     FROM items i
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.uid_lists->'uidlists',i.uid_lists->'hits','[]'::jsonb)) h(entry)
     JOIN %2$s article ON article.uid::text=CASE WHEN jsonb_typeof(h.entry)='string' THEN h.entry #>> '{}' ELSE h.entry->>'uid' END
     WHERE (article.able->>'keywords')::boolean IS TRUE
      AND ($2 IS NULL OR article.date >= $2) AND ($3 IS NULL OR article.date <= $3)
      AND ($4 IS NULL OR article.site=$4)
   )
   SELECT 'eligible',NULL,NULL,'',count(DISTINCT article_uid),count(DISTINCT article_uid) FROM group_hits
   UNION ALL
   SELECT 'class_day',NULL,group_uid,d,count(DISTINCT article_uid),count(DISTINCT article_uid)
    FROM group_hits GROUP BY group_uid,d
   UNION ALL
   SELECT 'item',item_uid,group_uid,'',
      (CASE WHEN $2 IS NULL AND $3 IS NULL AND $4 IS NULL THEN coalesce(max(total),sum(times)) ELSE sum(times) END)::bigint,
      count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY item_uid,group_uid
   UNION ALL
   SELECT 'item_day',item_uid,group_uid,d,sum(times)::bigint,count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY item_uid,group_uid,d
   UNION ALL
   SELECT 'keyword_all_day',NULL,NULL,d,count(DISTINCT article_uid),count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY d
   UNION ALL
   SELECT 'group_items_day',NULL,group_uid,d,count(DISTINCT article_uid),count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY group_uid,d
 $query$,v_keywords_source,v_galaxy)
 USING v_class,p_start,p_end,nullif(p_source,'');
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
  IF NOT silver.can_manage_scope(v_scope) AND
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
      WHERE g.place_id=ANY($2) AND (g.able->>'keywords')::boolean IS TRUE
        AND TRUE
        AND ($3 IS NULL OR g.date >= $3)
        AND ($4 IS NULL OR g.date <= $4)
        AND ($5 IS NULL OR g.site=$5)
    )
    SELECT k.uid::text,k.name,count(DISTINCT a.uid)::bigint
    FROM groups k
    LEFT JOIN articles a ON (coalesce(k.uid_lists->'uidlists',k.uid_lists->'articles','[]'::jsonb)) ? a.uid
    GROUP BY k.uid,k.name
    ORDER BY k.name,k.uid
  $query$,v_keywords_source,v_galaxy)
  USING v_class_uid,p_place_ids,p_start,p_end,nullif(p_source,'');
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
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL THEN
   RAISE EXCEPTION 'Unsupported Trace article Scope';
 END IF;
 IF p_place_ids IS NULL OR cardinality(p_place_ids)=0 THEN RETURN; END IF;
 IF cardinality(p_place_ids)>80 OR EXISTS(
    SELECT 1 FROM unnest(p_place_ids) AS id
    WHERE id IS NULL OR ((pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NOT NULL AND id !~ '^[A-Za-z0-9]{8}$') OR (pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL AND id !~ '^[A-Za-z0-9]{4}$'))
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
CREATE OR REPLACE FUNCTION silver.save_archive_media_exif(p_scope_id text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_suffix text;
  v_media regclass;
  v_row jsonb;
  v_id varchar(8);
  v_lat double precision;
  v_lng double precision;
  v_time text;
  v_found boolean;
  v_count integer := 0;
begin
  if v_scope !~ '^[a-z][a-z0-9]{0,14}$' then raise exception 'invalid Scope ID'; end if;
  if not silver.can_manage_scope(v_scope) then raise exception 'Scope management permission denied'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'EXIF rows must be a JSON array with at most 10000 entries';
  end if;
  select coalesce(nullif(galaxy_table,''),'galaxy') into v_suffix
    from silver.manage where id=v_scope;
  if v_suffix is null then raise exception 'Scope mapping not found'; end if;
  v_media := CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN to_regclass(format('silver.%I_anchor',v_scope))
   ELSE to_regclass(format('silver.%I',v_scope||'_'||v_suffix||'_media')) END;
  if v_media is null then raise exception 'Scope Galaxy Media table not found'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(v_row->>'media_uid','');
    v_lat := nullif(v_row->>'latitude','')::double precision;
    v_lng := nullif(v_row->>'longitude','')::double precision;
    v_time := nullif(btrim(coalesce(v_row->>'camera_local_time','')),'');
    if nullif(v_row->>'archive_id','') is null or nullif(v_row->>'entry_path','') is null then
      raise exception 'EXIF archive identity required';
    end if;
    if length(v_row->>'archive_id')>400 or length(v_row->>'entry_path')>2048 then
      raise exception 'EXIF archive path exceeds limit';
    end if;
    if (v_lat is null) <> (v_lng is null) or
      (v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180)) then
      raise exception 'EXIF coordinates invalid';
    end if;
    if v_lat is null and v_time is null then continue; end if;
    if v_id is not null then
      execute format('select exists(select 1 from %s where uid=$1 %s)',v_media,
       CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN 'AND type IN (''image'',''video'',''rune'',''suno'')' ELSE '' END)
        using v_id into v_found;
      if not v_found then raise exception 'EXIF media UID is not registered for this Scope'; end if;
    end if;
    insert into silver.archive_media_exif
      (scope_id,archive_id,entry_path,media_uid,platform,latitude,longitude,camera_local_time)
    values
      (v_scope,v_row->>'archive_id',v_row->>'entry_path',v_id,
       nullif(left(coalesce(v_row->>'platform',''),32),''),
       v_lat,v_lng,v_time)
    on conflict(scope_id,archive_id,entry_path)
      do update set media_uid=excluded.media_uid,
        platform=coalesce(excluded.platform,silver.archive_media_exif.platform),
        latitude=coalesce(excluded.latitude,silver.archive_media_exif.latitude),
        longitude=coalesce(excluded.longitude,silver.archive_media_exif.longitude),
        camera_local_time=coalesce(excluded.camera_local_time,silver.archive_media_exif.camera_local_time),
        imported_at=now();
    v_count := v_count+1;
  end loop;
  return v_count;
end
$function$
;
COMMIT;