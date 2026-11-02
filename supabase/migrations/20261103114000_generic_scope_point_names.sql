BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.save_scope_trace_place_names(p_scope_id text, p_uid character varying, p_names text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_anchor regclass;
 v_location jsonb;v_names text[];v_count integer;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT silver.can_manage_scope(v_scope)
 OR NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
 THEN RAISE EXCEPTION 'Scope permission denied' USING errcode='42501'; END IF;
 IF p_uid !~ '^[A-Za-z0-9]{8}$' OR p_names IS NULL OR cardinality(p_names)>250
 THEN RAISE EXCEPTION 'Invalid point aliases'; END IF;
 v_anchor:=to_regclass(format('silver.%I_anchor',v_scope));
 IF v_anchor IS NULL THEN RAISE EXCEPTION 'Scope Anchor missing'; END IF;
 EXECUTE format('SELECT attr->''location'' FROM %s WHERE uid=$1 AND type=''point'' FOR UPDATE',v_anchor)
 INTO v_location USING p_uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selected point not found'; END IF;
 SELECT coalesce(array_agg(DISTINCT val ORDER BY val),ARRAY[]::text[]) INTO v_names FROM (
 SELECT jsonb_array_elements_text(CASE jsonb_typeof(v_location)
 WHEN 'array' THEN v_location WHEN 'string' THEN jsonb_build_array(v_location)
 ELSE '[]'::jsonb END) AS val
 UNION ALL SELECT btrim(name) FROM unnest(p_names) name
 ) t WHERE nullif(btrim(val),'') IS NOT NULL AND char_length(val)<=320;
 EXECUTE format('UPDATE %s SET attr=CASE WHEN cardinality($2::text[])=0 THEN attr-''location'' ELSE jsonb_set(attr,''{location}'',to_jsonb($2::text[]),true) END WHERE uid=$1 AND type=''point''',v_anchor)
 USING p_uid,v_names;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END $function$
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
 ORDER BY a.title,a.uid LIMIT $2 $q$,v_anchor)
 USING v_term,least(greatest(coalesce(p_limit,8),1),8);
END $function$
;
COMMIT;