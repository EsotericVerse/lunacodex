-- Unify Culture/Statistics place density reads under Scope analytics without changing RLS.
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
  IF v_mode='trace_places' THEN
    -- Keep the existing security-definer aggregate for public Trace counts,
    -- but expose it through the shared Scope analytics endpoint.
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
    RETURN silver.scope_type_attr(v_scope,'class',pg_catalog.jsonb_build_object('op','catalog','classUid',v_class));
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
NOTIFY pgrst,'reload schema';