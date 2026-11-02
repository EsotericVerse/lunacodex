BEGIN;
CREATE OR REPLACE FUNCTION silver.apply_scope_point_links(p_scope_id text,p_updates jsonb,p_mode text DEFAULT 'place_id')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $func$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_anchor regclass;v_galaxy regclass;v_suffix text;
v_total int;v_eligible int;v_affected int;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT silver.can_manage_scope(v_scope)
    OR nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL
 THEN RAISE EXCEPTION 'Scope management permission required' USING ERRCODE='42501'; END IF;
 IF p_mode NOT IN ('place_id','missing_location') THEN RAISE EXCEPTION 'Unknown point link mode'; END IF;
 SELECT anchor_table INTO v_suffix FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scope unavailable'; END IF;
 v_anchor:=to_regclass(format('silver.%I',v_scope||'_'||coalesce(nullif(v_suffix,''),'anchor')));
 v_galaxy:=to_regclass(format('silver.%I',v_scope||'_galaxy'));
 IF v_anchor IS NULL OR v_galaxy IS NULL THEN RAISE EXCEPTION 'Scope Anchor/Galaxy missing'; END IF;
 IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 v_total:=jsonb_array_length(p_updates);
 IF v_total NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_updates) AS u(uid text,place_id text,expected_place_id text,manual boolean)
     WHERE u.uid !~ '^[A-Za-z0-9]{8}$' OR u.place_id !~ '^[A-Za-z0-9]{8}$'
     OR (p_mode='place_id' AND u.expected_place_id IS NOT NULL)
     OR (p_mode='missing_location' AND u.expected_place_id IS NOT NULL AND u.expected_place_id<>u.place_id))
 OR (SELECT count(DISTINCT uid) FROM jsonb_to_recordset(p_updates) u(uid text))<>v_total
 THEN RAISE EXCEPTION 'Invalid or duplicated anchor/article UID'; END IF;
 EXECUTE format('SELECT count(*) FROM jsonb_to_recordset($1) u(place_id text) JOIN %s a ON a.uid=u.place_id AND a.type=''point'' AND length(btrim(a.title)) BETWEEN 1 AND 200',v_anchor)
 INTO v_eligible USING p_updates;
 IF v_eligible<>v_total THEN RAISE EXCEPTION 'Point UID unavailable'; END IF;
 IF p_mode='place_id' THEN
   EXECUTE format('UPDATE %s g SET place_id=u.place_id FROM jsonb_to_recordset($1) u(uid text,place_id text) WHERE g.uid=u.uid AND NULLIF(btrim(g.place_id),'''') IS NULL',v_galaxy) USING p_updates;
 ELSE
   EXECUTE format('UPDATE %1$s g SET location=btrim(a.title),place_id=coalesce(nullif(btrim(g.place_id),''''),u.place_id) FROM jsonb_to_recordset($1) u(uid text,place_id text,expected_place_id text,manual boolean) JOIN %2$s a ON a.uid=u.place_id AND a.type=''point'' WHERE g.uid=u.uid AND nullif(btrim(g.place_id),'''') IS NOT DISTINCT FROM u.expected_place_id AND (g.location IS NULL OR g.location ~ ''^[[:space:]　]*$'')',v_galaxy,v_anchor) USING p_updates;
 END IF;
 GET DIAGNOSTICS v_affected=ROW_COUNT;
 IF v_affected<>v_total THEN RAISE EXCEPTION 'Concurrent changes, whole batch rolled back'; END IF;
 RETURN v_affected;
END $func$;
CREATE OR REPLACE FUNCTION silver.apply_timeline_place_ids(p_scope_id text,p_updates jsonb) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$ SELECT silver.apply_scope_point_links(p_scope_id,p_updates,'place_id') $f$;
CREATE OR REPLACE FUNCTION silver.apply_timeline_missing_places(p_scope_id text,p_updates jsonb) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$ SELECT silver.apply_scope_point_links(p_scope_id,p_updates,'missing_location') $f$;
COMMIT;