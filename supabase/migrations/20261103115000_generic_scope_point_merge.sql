BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.merge_scope_trace_place_names(p_scope_id text, p_keep_uid character varying, p_remove_uids character varying[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_anchor regclass;v_galaxy regclass;v_count integer;v_conflict boolean;v_names text[];
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
  OR NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
  OR NOT silver.can_manage_scope(v_scope)
 THEN RAISE EXCEPTION 'Scope point merge permission denied' USING ERRCODE='42501'; END IF;
 IF p_keep_uid !~ '^[A-Za-z0-9]{8}$'
 OR p_remove_uids IS NULL OR cardinality(p_remove_uids) NOT BETWEEN 1 AND 100
 OR p_keep_uid=ANY(p_remove_uids)
 OR EXISTS(SELECT 1 FROM unnest(p_remove_uids) x WHERE x !~ '^[A-Za-z0-9]{8}$')
 OR cardinality(p_remove_uids)<>(SELECT count(DISTINCT x) FROM unnest(p_remove_uids) x)
 THEN RAISE EXCEPTION 'Invalid point merge UIDs' USING ERRCODE='22023'; END IF;
 v_anchor:=to_regclass(format('silver.%I_anchor',v_scope));
 v_galaxy:=to_regclass(format('silver.%I_galaxy',v_scope));
 IF v_anchor IS NULL OR v_galaxy IS NULL THEN RAISE EXCEPTION 'Scope Anchor or Galaxy missing'; END IF;
 EXECUTE format('SELECT count(*) FROM %s WHERE type=''point'' AND (uid=$1 OR uid=ANY($2))',v_anchor)
 INTO v_count USING p_keep_uid,p_remove_uids;
 IF v_count<>cardinality(p_remove_uids)+1 THEN RAISE EXCEPTION 'Missing or cross-Scope point UIDs'; END IF;
 EXECUTE format($q$SELECT EXISTS(SELECT 1 FROM %s a WHERE a.type IN ('path','trace')
 AND jsonb_typeof(a.attr->'point')='array' AND (a.attr->'point') ? $1
 AND (a.attr->'point') ?| $2::text[])$q$,v_anchor)
 INTO v_conflict USING p_keep_uid,p_remove_uids::text[];
 IF v_conflict THEN RAISE EXCEPTION 'Route already contains both kept and removed points'; END IF;
 EXECUTE format($q$
 SELECT array_agg(DISTINCT name ORDER BY name) FROM (
 SELECT title::text AS name FROM %1$s WHERE type='point' AND (uid=$1 OR uid=ANY($2))
 UNION ALL
 SELECT jsonb_array_elements_text(CASE jsonb_typeof(attr->'location')
   WHEN 'array' THEN attr->'location' WHEN 'string' THEN jsonb_build_array(attr->>'location')
   ELSE '[]'::jsonb END)
 FROM %1$s WHERE type='point' AND (uid=$1 OR uid=ANY($2))
 ) aliases WHERE nullif(btrim(name),'') IS NOT NULL $q$,v_anchor)
 INTO v_names USING p_keep_uid,p_remove_uids;
 EXECUTE format($q$UPDATE %s a SET attr=jsonb_set(a.attr,'{point}',
 (SELECT coalesce(jsonb_agg(CASE WHEN x.value=ANY($2) THEN to_jsonb($1::text)
 ELSE to_jsonb(x.value) END ORDER BY x.ord),'[]'::jsonb)
 FROM jsonb_array_elements_text(a.attr->'point') WITH ORDINALITY x(value,ord)),true)
 WHERE a.type IN ('path','trace') AND jsonb_typeof(a.attr->'point')='array'
 AND (a.attr->'point') ?| $2::text[]$q$,v_anchor)
 USING p_keep_uid,p_remove_uids::text[];
 EXECUTE format('UPDATE %s SET place_id=$1 WHERE place_id=ANY($2)',v_galaxy)
 USING p_keep_uid,p_remove_uids;
 EXECUTE format('UPDATE %s SET attr=jsonb_set(attr,''{location}'',to_jsonb($2::text[]),true) WHERE uid=$1 AND type=''point''',v_anchor)
 USING p_keep_uid,coalesce(v_names,ARRAY[]::text[]);
 EXECUTE format('DELETE FROM %s WHERE type=''point'' AND uid=ANY($1)',v_anchor) USING p_remove_uids;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>cardinality(p_remove_uids) THEN RAISE EXCEPTION 'Point merge affected unexpected row count'; END IF;
 RETURN v_count;
END $function$
;
COMMIT;