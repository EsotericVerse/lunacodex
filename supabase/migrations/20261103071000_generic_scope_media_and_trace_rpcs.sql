BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';

-- One media-count implementation for every registered Scope; type, not Scope ID, defines multimedia.
CREATE OR REPLACE FUNCTION silver.read_scope_linked_media_count(p_scope_id text,p_start date DEFAULT NULL,p_end date DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_anchor regclass;v_galaxy regclass;v_suffix text;v_count bigint;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR (p_start IS NOT NULL AND p_end IS NOT NULL AND p_start>p_end)
 THEN RAISE EXCEPTION 'Invalid Scope or date range' USING errcode='22023'; END IF;
 SELECT anchor_table INTO v_suffix FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active;
 IF NOT FOUND THEN RETURN 0; END IF;
 v_anchor:=to_regclass(format('silver.%I',v_scope||'_'||coalesce(nullif(v_suffix,''),'anchor')));
 v_galaxy:=to_regclass(format('silver.%I',v_scope||'_galaxy'));
 IF v_anchor IS NULL OR v_galaxy IS NULL THEN RETURN 0; END IF;
 EXECUTE format($q$
 SELECT count(*)::bigint FROM
 (SELECT DISTINCT unnest(g.media_link)::text AS uid FROM %1$s g
 WHERE (g.able->>'statics')::boolean IS TRUE AND coalesce(g.content,'')<>''
 AND ($1 IS NULL OR g.date >= $1) AND ($2 IS NULL OR g.date <= $2)) refs
 WHERE EXISTS (SELECT 1 FROM %2$s m WHERE m.uid=refs.uid
 AND m.type IN ('image','video','rune','suno') AND m.invisible IS FALSE)
 $q$,v_galaxy,v_anchor) INTO v_count USING p_start,p_end;
 RETURN coalesce(v_count,0);
END $fn$;

-- Scope-independent location suggestion RPC; only the authorized Galaxy table varies.
CREATE OR REPLACE FUNCTION silver.trace_place_suggestions(p_scope_id text,p_limit integer DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_galaxy regclass;v_found boolean;v_result jsonb;
BEGIN
 IF nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL
 OR v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT silver.can_manage_scope(v_scope)
 THEN RAISE EXCEPTION 'Scope management permission denied' USING errcode='42501'; END IF;
 IF coalesce(p_limit,0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid suggestion limit'; END IF;
 SELECT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active) INTO v_found;
 IF NOT v_found THEN RAISE EXCEPTION 'Scope unavailable'; END IF;
 v_galaxy:=to_regclass(format('silver.%I',v_scope||'_galaxy'));
 IF v_galaxy IS NULL THEN RAISE EXCEPTION 'Scope Galaxy unavailable'; END IF;
 EXECUTE format($q$ SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM
 (SELECT btrim(location) AS name,count(*)::integer AS article_count
 FROM %s WHERE nullif(btrim(location),'') IS NOT NULL
 GROUP BY btrim(location) ORDER BY count(*) DESC,btrim(location) ASC LIMIT $1) s $q$,v_galaxy)
 INTO v_result USING p_limit;
 RETURN v_result;
END $fn$;
COMMIT;