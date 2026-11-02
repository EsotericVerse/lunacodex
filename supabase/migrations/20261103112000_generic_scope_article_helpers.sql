BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.batch_fill_galaxy_location(p_scope_id text, p_uids text[], p_place text, p_apply boolean DEFAULT false, p_expected_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_rel text;
  normalized_uids text[];
  requested_count integer;
  matched_count integer;
  eligible_count integer;
  affected_count integer;
  place_label text := btrim(coalesce(p_place,''));
BEGIN
  IF auth.uid() IS NULL OR p_scope_id IS NULL
    OR pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL
    OR NOT silver.can_manage_scope(p_scope_id)
  THEN
    RAISE EXCEPTION 'Scope management permission denied';
  END IF;
  IF place_label='' OR length(place_label)>200 THEN
    RAISE EXCEPTION 'Place name must be 1 to 200 characters';
  END IF;
  IF p_uids IS NULL OR cardinality(p_uids)<1 OR cardinality(p_uids)>200
     OR EXISTS (SELECT 1 FROM unnest(p_uids) AS item(uid) WHERE uid IS NULL OR uid !~ '^[A-Za-z0-9]{8}$')
  THEN
    RAISE EXCEPTION 'Select 1 to 200 valid article UIDs';
  END IF;
  SELECT array_agg(DISTINCT value) INTO normalized_uids
  FROM unnest(p_uids) AS item(value);
  requested_count := cardinality(normalized_uids);
  target_rel := format('%I.%I','silver',p_scope_id||'_galaxy');
  EXECUTE format('SELECT count(*) FROM %s WHERE uid=ANY($1::character(8)[])',target_rel)
    INTO matched_count USING normalized_uids;
  IF matched_count<>requested_count THEN
    RAISE EXCEPTION 'Selected articles changed; reload the list before writing';
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM %s WHERE uid=ANY($1::character(8)[]) AND nullif(btrim(location),'''') IS NULL',
    target_rel
  ) INTO eligible_count USING normalized_uids;
  IF NOT p_apply THEN
    RETURN jsonb_build_object('applied',false,'selected',requested_count,'eligible',eligible_count,
      'skipped',requested_count-eligible_count);
  END IF;
  IF p_expected_count IS NULL OR p_expected_count<1 OR p_expected_count<>eligible_count THEN
    RAISE EXCEPTION 'Preview is stale; refresh selection before writing';
  END IF;
  EXECUTE format(
    'UPDATE %s SET location=$2 WHERE uid=ANY($1::character(8)[]) AND nullif(btrim(location),'''') IS NULL',
    target_rel
  ) USING normalized_uids,place_label;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count<>p_expected_count THEN
    RAISE EXCEPTION 'Matching articles changed; transaction rolled back';
  END IF;
  RETURN jsonb_build_object('applied',true,'selected',requested_count,
    'count',affected_count,'skipped',requested_count-affected_count);
END;
$function$
;
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL OR p_scope_id IS NULL
     OR NOT silver.can_manage_scope(p_scope_id) THEN
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
    ' FROM %s WHERE %s ORDER BY createtime ASC,uid ASC LIMIT 3) s',
    target_rel,predicate)
    INTO first_sample USING start_at,end_before;
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s)),''[]''::jsonb) FROM ('||
    ' SELECT btrim(uid::text) AS uid, coalesce(title,'''') AS title,'||
    ' to_char(createtime AT TIME ZONE ''Asia/Taipei'',''YYYY-MM-DD'') AS date'||
    ' FROM %s WHERE %s ORDER BY createtime DESC,uid DESC LIMIT 3) s',
    target_rel,predicate)
    INTO last_sample USING start_at,end_before;
  RETURN jsonb_build_object('count',missing_count,'first',first_sample,'last',last_sample,'applied',false);
END;
$function$
;
CREATE OR REPLACE FUNCTION silver.preview_timeline_missing_place_windows(p_scope_id text, p_windows jsonb, p_limit integer DEFAULT 10000, p_offset integer DEFAULT 0)
 RETURNS TABLE(article_uid text, article_title text, article_time timestamp with time zone, existing_place_id text, window_index integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE total integer;
BEGIN
 IF nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL OR pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL
   OR NOT silver.can_manage_scope(p_scope_id) THEN
   RAISE EXCEPTION 'Timeline 預覽需要 Scope 管理權限' USING errcode='42501';
 END IF;
 IF jsonb_typeof(p_windows) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Invalid Timeline window array';
 END IF;
 total:=jsonb_array_length(p_windows);
 IF total NOT BETWEEN 1 AND 10000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
   OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN
   RAISE EXCEPTION 'Timeline 預覽必須分段，每批最多 10000 個區間';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_windows) a(item)
   WHERE (a.item->>'index') IS NULL OR (a.item->>'index') !~ '^[0-9]{1,6}$'
     OR (a.item->>'start_time') IS NULL
     OR (a.item->>'end_time') IS NULL
     OR (a.item->>'start_time') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
     OR (a.item->>'end_time') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T') THEN
   RAISE EXCEPTION 'Timeline 區間欄位錯誤';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_windows)
   AS w(index integer,start_time timestamptz,end_time timestamptz)
   WHERE w.start_time IS NULL OR w.end_time IS NULL OR w.end_time<=w.start_time
     OR w.end_time-w.start_time>interval '12 hours') THEN
   RAISE EXCEPTION 'Timeline 區間必須為有效 12 小時以內時間';
 END IF;
 RETURN QUERY EXECUTE format($query$
   WITH w AS MATERIALIZED (
     SELECT index AS window_index,start_time,end_time
     FROM jsonb_to_recordset($1) AS j(index integer,start_time timestamptz,end_time timestamptz)
   )
   SELECT g.uid::text,g.title::text,g.createtime,g.place_id::text,w.window_index
   FROM w JOIN LATERAL (
     SELECT uid,title,createtime,place_id FROM silver.%I
     WHERE createtime>=w.start_time AND createtime<w.end_time
       AND NULLIF(btrim(place_id),'') IS NULL
     OFFSET 0
   ) g ON TRUE
   ORDER BY g.uid,w.window_index LIMIT $2 OFFSET $3
 $query$,p_scope_id||'_galaxy')
 USING p_windows,p_limit,p_offset;
END
$function$
;
CREATE OR REPLACE FUNCTION silver.refresh_scope_search_summary(p_scope_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE
  v_id text := lower(btrim(coalesce(p_scope_id,'')));
  v_galaxy regclass;
  v_count bigint;
  v_words bigint;
  v_start date;
  v_end date;
  v_now timestamptz := clock_timestamp();
  v_snapshot jsonb;
  v_rows integer;
BEGIN
  IF v_id !~ '^[a-z][a-z0-9]{0,14}$' THEN
    RAISE EXCEPTION 'Invalid article Scope ID' USING errcode='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM silver.manage WHERE id=v_id
                 AND manage_role='scope' AND active IS TRUE) THEN
    RAISE EXCEPTION 'Unknown or inactive article Scope' USING errcode='22023';
  END IF;
  IF NOT silver.can_manage_scope(v_id) THEN
    RAISE EXCEPTION 'Not authorized to refresh this Scope' USING errcode='42501';
  END IF;
  v_galaxy:=to_regclass(format('silver.%I',v_id||'_galaxy'));
  IF v_galaxy IS NULL THEN
    RAISE EXCEPTION 'Scope Galaxy unavailable' USING errcode='22023';
  END IF;
  EXECUTE format($q$
    SELECT count(*)::bigint,
      coalesce(sum(char_length(regexp_replace(regexp_replace(content,'<[^>]*>','','g'),
        '[[:space:]　]+','','g'))),0)::bigint,
      min(coalesce(date,(createtime at time zone 'Asia/Taipei')::date)),
      max(coalesce(date,(createtime at time zone 'Asia/Taipei')::date))
    FROM %s
    WHERE (able->>'search')::boolean IS TRUE
      AND nullif(btrim(content),'') IS NOT NULL
  $q$,v_galaxy)
  INTO v_count,v_words,v_start,v_end;
  v_snapshot:=jsonb_build_object(
    'article_count',v_count,'word_count',v_words,
    'first_date',v_start,'last_date',v_end,'refreshed_at',v_now
  );
  EXECUTE format(
    'UPDATE silver.%I SET status=jsonb_set(coalesce(status,''{}''::jsonb),''{search}'',$1,true) WHERE id=$2',
    v_id)
  USING v_snapshot,v_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Scope status was not updated' USING errcode='22023';
  END IF;
  RETURN jsonb_build_object('scope_id',v_id)||v_snapshot;
END;
$function$
;
COMMIT;