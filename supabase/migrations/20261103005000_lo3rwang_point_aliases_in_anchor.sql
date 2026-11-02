BEGIN;
-- Persist the verified native Point/Path/Trace SQL functions in source control.
-- Point aliases and addresses stay in attr.location; link UIDs stay in attr.point/path.
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
END $function$;

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
END $function$;

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
END $function$;
COMMIT;
