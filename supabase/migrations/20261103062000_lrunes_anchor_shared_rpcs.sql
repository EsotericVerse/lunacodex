BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
-- Shared RPCs use the existing Scope Anchor for both eight-character UID Scopes.
-- No new tables or indexes; lrunes_daily intentionally untouched.
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
       OR u.place_id IS NULL OR u.place_id !~ ('^[A-Za-z0-9]{'||CASE WHEN p_scope_id IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$')
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
  $query$,CASE WHEN p_scope_id IN ('lo3rwang','lrunes') THEN p_scope_id||'_anchor' ELSE p_scope_id||'_trace' END,CASE WHEN p_scope_id IN ('lo3rwang','lrunes') THEN 'a.type=''point''' ELSE 'a.trace_type=''space_anchor''' END) INTO eligible USING p_updates;
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
  $query$,p_scope_id||'_galaxy',CASE WHEN p_scope_id IN ('lo3rwang','lrunes') THEN p_scope_id||'_anchor' ELSE p_scope_id||'_trace' END,CASE WHEN p_scope_id IN ('lo3rwang','lrunes') THEN 'a.type=''point''' ELSE 'a.trace_type=''space_anchor''' END) USING p_updates;
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
       OR u.place_id IS NULL OR u.place_id !~ ('^[A-Za-z0-9]{'||CASE WHEN p_scope_id IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$')
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
    case when p_scope_id IN ('lo3rwang','lrunes') then p_scope_id||'_anchor' else p_scope_id||'_trace' end,
    case when p_scope_id IN ('lo3rwang','lrunes') then 'a.type=''point'''
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

 -- Unified lrunes point merge: keep all UID8 links and move name aliases into attr.location.
 IF p_scope_id='lrunes' THEN
   IF p_keep_uid !~ '^[A-Za-z0-9]{8}$'
      OR EXISTS(SELECT 1 FROM unnest(p_remove_uids) x WHERE x !~ '^[A-Za-z0-9]{8}$') THEN
     RAISE EXCEPTION 'Invalid unified point UID';
   END IF;
   SELECT count(*) INTO count_matches FROM silver.lrunes_anchor
     WHERE type='point' AND (uid=p_keep_uid OR uid=ANY(p_remove_uids));
   IF count_matches<>cardinality(p_remove_uids)+1 THEN
     RAISE EXCEPTION '指定定錨點不存在或跨 Scope';
   END IF;
   IF EXISTS(SELECT 1 FROM silver.lrunes_anchor a
       WHERE a.type IN ('path','trace') AND jsonb_typeof(a.attr->'point')='array'
         AND (a.attr->'point') ? p_keep_uid AND (a.attr->'point') ?| p_remove_uids::text[]) THEN
     RAISE EXCEPTION '路線會重複指向同一點，請先調整路線';
   END IF;
   SELECT array_agg(DISTINCT name ORDER BY name) INTO all_names FROM (
     SELECT title::text AS name FROM silver.lrunes_anchor
       WHERE uid=p_keep_uid OR uid=ANY(p_remove_uids)
     UNION ALL
     SELECT jsonb_array_elements_text(CASE jsonb_typeof(attr->'location')
       WHEN 'array' THEN attr->'location'
       WHEN 'string' THEN jsonb_build_array(attr->>'location')
       ELSE '[]'::jsonb END)
       FROM silver.lrunes_anchor WHERE type='point'
         AND (uid=p_keep_uid OR uid=ANY(p_remove_uids))
   ) names WHERE nullif(btrim(name),'') IS NOT NULL;
   UPDATE silver.lrunes_anchor a SET attr=jsonb_set(a.attr,'{point}',
     (SELECT coalesce(jsonb_agg(
       CASE WHEN x.value=ANY(p_remove_uids) THEN to_jsonb(p_keep_uid::text)
            ELSE to_jsonb(x.value) END ORDER BY x.ord),'[]'::jsonb)
      FROM jsonb_array_elements_text(a.attr->'point') WITH ORDINALITY x(value,ord)),true)
    WHERE a.type IN ('path','trace') AND jsonb_typeof(a.attr->'point')='array'
      AND (a.attr->'point') ?| p_remove_uids::text[];
   -- Preserve article links instead of leaving dangling point UIDs.
   UPDATE silver.lrunes_galaxy SET place_id=p_keep_uid WHERE place_id=ANY(p_remove_uids);
   UPDATE silver.lrunes_anchor SET attr=jsonb_set(attr,'{location}',
      to_jsonb(coalesce(all_names,ARRAY[]::text[])),true)
     WHERE uid=p_keep_uid AND type='point';
   DELETE FROM silver.lrunes_anchor WHERE type='point' AND uid=ANY(p_remove_uids);
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

 -- Unified lrunes names belong to point.attr.location, not the old UID4 place table.
 IF p_scope_id='lrunes' THEN
   IF p_uid !~ '^[A-Za-z0-9]{8}$' THEN RAISE EXCEPTION 'Invalid point UID'; END IF;
   IF p_names IS NULL OR cardinality(p_names)>250 THEN RAISE EXCEPTION 'Too many place name aliases'; END IF;
   SELECT attr->'location' INTO v_location FROM silver.lrunes_anchor
      WHERE uid=p_uid AND type='point' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Selected anchor UID does not exist in this Scope'; END IF;
   SELECT coalesce(array_agg(DISTINCT val ORDER BY val),ARRAY[]::text[]) INTO v_names
    FROM (
       SELECT jsonb_array_elements_text(CASE jsonb_typeof(v_location)
         WHEN 'array' THEN v_location WHEN 'string' THEN jsonb_build_array(v_location)
         ELSE '[]'::jsonb END) AS val
       UNION ALL SELECT btrim(name) AS val FROM unnest(p_names) name
    ) names WHERE nullif(btrim(val),'') IS NOT NULL AND char_length(val)<=320;
   UPDATE silver.lrunes_anchor SET attr=CASE
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

 IF p_scope_id='lrunes' THEN
   RETURN QUERY
   SELECT a.uid::varchar,a.title::text,
      CASE WHEN (a.attr ? 'longitude') AND (a.attr ? 'latitude')
         THEN ARRAY[(a.attr->>'longitude')::double precision,(a.attr->>'latitude')::double precision]::double precision[]
         ELSE NULL::double precision[] END
   FROM silver.lrunes_anchor a
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
    OR v_uid !~ ('^[A-Za-z0-9]{'||CASE WHEN v_from IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$') THEN
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
 v_source:=CASE WHEN v_from IN ('lo3rwang','lrunes') THEN to_regclass(format('silver.%I_anchor',v_from))
   ELSE to_regclass(format('silver.%I_keywords',v_from)) END;
 v_source_sql:=CASE WHEN v_from IN ('lo3rwang','lrunes')
   THEN format('(SELECT uid,type,title AS name,description AS "desc",ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists,invisible FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_from)
   ELSE v_source::text END;
 v_target:=CASE WHEN v_to IN ('lo3rwang','lrunes') THEN to_regclass(format('silver.%I_anchor',v_to))
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
     EXECUTE (CASE WHEN v_to IN ('lo3rwang','lrunes')
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
       USING v_item_uid,'item',v_item.name,v_item."desc",v_item.lists,CASE WHEN v_to IN ('lo3rwang','lrunes') THEN '{"total":0,"uidlists":[]}'::jsonb ELSE '{"hits":[]}'::jsonb END,v_item.invisible;
     v_item_ids:=array_append(v_item_ids,v_item_uid);
     v_item_count:=v_item_count+1;
   END LOOP;
   v_group_uid:=silver.new_keyword_tree_uid(v_to);
   EXECUTE (CASE WHEN v_to IN ('lo3rwang','lrunes')
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
     USING v_group_uid,'group',v_group.name,v_group."desc",v_item_ids,CASE WHEN v_to IN ('lo3rwang','lrunes') THEN '{"total":0,"uidlists":[]}'::jsonb ELSE '{"articles":[]}'::jsonb END,v_group.invisible;
   v_group_ids:=array_append(v_group_ids,v_group_uid);
   v_group_count:=v_group_count+1;
 END LOOP;
 v_root:=silver.new_keyword_tree_uid(v_to);
 EXECUTE (CASE WHEN v_to IN ('lo3rwang','lrunes')
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
COMMIT;
