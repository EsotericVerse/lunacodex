-- Keep atomic article/location operations while removing Supabase Auth UUID coupling.
-- api.current_user_id() resolves the already-signed JWT subject as text on all PostgreSQL providers.
-- Existing silver.manage('scope', scopeid) authorization and atomicity are unchanged.
BEGIN;
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
  IF api.current_user_id() IS NULL OR p_scope_id IS NULL
    OR pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',p_scope_id)) IS NULL
    OR NOT coalesce((SELECT allowed FROM silver.manage('scope',p_scope_id)),false)
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
      SELECT uid FROM %1$s WHERE site=$1 ORDER BY uid LIMIT $3 FOR UPDATE SKIP LOCKED
    )
    UPDATE %1$s AS galaxy SET site=$2 FROM targets WHERE galaxy.uid=targets.uid
  $sql$,v_galaxy)
    USING btrim(p_before),btrim(p_after),p_batch_size;
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  RETURN v_affected;
END;
$function$
;
DROP FUNCTION silver.loc_public_routing_state() RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
