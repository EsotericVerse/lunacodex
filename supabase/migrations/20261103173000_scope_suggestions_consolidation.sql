-- Consolidate owner-only Keyword and Point suggestions into (scopeid,type,attr).
-- Preserve atomic policies and original signed session requirement; no new columns.
BEGIN;
CREATE OR REPLACE FUNCTION silver.scope_type_attr(p_scope_id text, p_type text, p_attr jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_type text:=btrim(coalesce(p_type,''));
 v_suffix text; v_relation regclass; v_op text; v_uid text;
 v_owner boolean; v_limit integer; v_offset integer; v_result jsonb;
 v_config regclass; v_galaxy regclass; v_suggestions text[];
 v_rows integer; v_is_public boolean; v_link_count integer;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
 OR v_type NOT IN ('date','period','era','point','path','trace','image','video','rune','suno','category','class','group','item')
 OR pg_catalog.jsonb_typeof(p_attr) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Invalid scope/type/attr' USING ERRCODE='22023'; END IF;
 v_op:=coalesce(p_attr->>'op','read');
 IF v_op NOT IN ('read','insert','update','patch','delete','link','catalog','suggestions')
 THEN RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_attr) k(key)
   WHERE k.key NOT IN ('op','uid','title','description','invisible','data','where','limit','offset','updates','mode','classUid'))
 THEN RAISE EXCEPTION 'Unknown JSONB request field' USING ERRCODE='22023'; END IF;
 SELECT anchor_table INTO v_suffix FROM silver.manage
 WHERE id=v_scope AND manage_role='scope' AND active IS TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive Scope' USING ERRCODE='22023'; END IF;
 v_relation:=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope||'_'||coalesce(nullif(v_suffix,''),'anchor')));
 IF v_relation IS NULL THEN RAISE EXCEPTION 'Scope Anchor not available' USING ERRCODE='22023'; END IF;
 IF v_op='catalog' THEN
  IF v_type<>'class' OR p_attr ? 'uid' OR p_attr ? 'data' THEN
   RAISE EXCEPTION 'Invalid keyword catalog request' USING ERRCODE='22023';
  END IF;
  DECLARE
 p_class_uid text:=p_attr->>'classUid';
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_class text;
 v_current text;
 v_config regclass;
 v_keywords regclass;
 v_keywords_source text;
 v_result jsonb;
 v_public boolean:=false;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
    SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
    THEN RETURN '{}'::jsonb; END IF;
 v_config:=to_regclass(format('silver.%I',v_scope));
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 IF v_config IS NULL OR v_keywords IS NULL THEN RETURN '{}'::jsonb; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN RETURN '{}'::jsonb; END IF;
 EXECUTE format('SELECT current_keyword_class_uid FROM %s WHERE id=$1',v_config)
  INTO v_current USING v_scope;
 v_class:=coalesce(nullif(p_class_uid,''),v_current);
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN '{}'::jsonb; END IF;
 IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) AND
   NOT silver.keyword_class_is_shared(v_scope,v_class) THEN RETURN '{}'::jsonb; END IF;
 EXECUTE format($query$
 WITH cl AS (SELECT uid,type,name,"desc",lists FROM %s WHERE uid=$1 AND type='class'),
 group_nodes AS (
  SELECT g.uid,g.type,g.name,g."desc",g.lists
  FROM cl CROSS JOIN LATERAL unnest(cl.lists) child(uid)
  JOIN %s g ON g.uid=child.uid AND g.type='group'
 ), item_nodes AS (
  -- Item descriptions can contain unpublished rules and private meanings.
  -- Public catalog needs only the UID and label for Culture/Statistics.
  SELECT i.uid,i.type,i.name,''::text AS "desc"
  FROM group_nodes g CROSS JOIN LATERAL unnest(g.lists) child(uid)
  JOIN %s i ON i.uid=child.uid AND i.type='item'
 ), members AS (
  SELECT uid,type,name,"desc",lists FROM cl
  UNION ALL SELECT uid,type,name,"desc",lists FROM group_nodes
  UNION ALL SELECT uid,type,name,"desc",'{}'::text[] FROM item_nodes
 )
 SELECT jsonb_build_object('class_uid',$1,'rows',coalesce(
  jsonb_agg(jsonb_build_object('uid',uid,'type',type,'name',name,'desc',"desc",
    'lists',lists,'uid_lists','[]'::jsonb)),'[]'::jsonb))
 FROM members
 $query$,v_keywords_source,v_keywords_source,v_keywords_source) INTO v_result USING v_class;
 RETURN coalesce(v_result,'{}'::jsonb);
END;
 END IF;
 v_uid:=p_attr->>'uid';
 IF v_uid IS NOT NULL AND v_uid !~ '^[A-Za-z0-9]{8}$'
 THEN RAISE EXCEPTION 'Invalid UID' USING ERRCODE='22023'; END IF;
 v_owner:=coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false);
 IF v_op='suggestions' THEN
   -- Suggestions are owner-only, whether sourced from Scope config or Galaxy.
   IF NOT v_owner THEN
     RAISE EXCEPTION 'Scope management permission denied' USING ERRCODE='42501';
   END IF;
   IF v_type='item' THEN
     IF p_attr ? 'uid' OR p_attr ? 'data' OR p_attr ? 'where'
     THEN RAISE EXCEPTION 'Invalid Keyword suggestion request' USING ERRCODE='22023'; END IF;
     v_config:=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope));
     IF v_config IS NULL THEN RETURN '[]'::jsonb; END IF;
     IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid=v_config AND attname='keyword_suggestions'
         AND attnum>0 AND NOT attisdropped)
     THEN RETURN '[]'::jsonb; END IF;
     EXECUTE pg_catalog.format('SELECT keyword_suggestions FROM %s WHERE id=$1',v_config)
       INTO v_suggestions USING v_scope;
     RETURN pg_catalog.to_jsonb(coalesce(v_suggestions,ARRAY[]::text[]));
   ELSIF v_type='point' THEN
     IF nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'') IS NULL
     THEN RAISE EXCEPTION 'Signed Scope session required' USING ERRCODE='42501'; END IF;
     IF p_attr ? 'uid' OR p_attr ? 'data' OR p_attr ? 'where'
     THEN RAISE EXCEPTION 'Invalid Point suggestion request' USING ERRCODE='22023'; END IF;
     v_limit:=coalesce((p_attr->>'limit')::integer,40);
     IF v_limit NOT BETWEEN 1 AND 500
     THEN RAISE EXCEPTION 'Invalid suggestion limit' USING ERRCODE='22023'; END IF;
     v_galaxy:=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope||'_galaxy'));
     IF v_galaxy IS NULL THEN RAISE EXCEPTION 'Scope Galaxy unavailable' USING ERRCODE='22023'; END IF;
     EXECUTE pg_catalog.format($q$ SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
       FROM (SELECT btrim(location) AS name,count(*)::integer AS article_count
         FROM %s WHERE nullif(btrim(location),'') IS NOT NULL
         GROUP BY btrim(location) ORDER BY count(*) DESC,btrim(location) ASC
         LIMIT $1) s $q$,v_galaxy) INTO v_result USING v_limit;
     RETURN v_result;
   END IF;
   RAISE EXCEPTION 'Suggestions require Point or Item type' USING ERRCODE='22023';
 END IF;
 v_is_public:=v_type IN ('date','period','era','point','path','trace','image','video','rune','suno');
 IF v_op='read' THEN
   IF NOT v_owner AND NOT v_is_public THEN RETURN '[]'::jsonb; END IF;
   v_limit:=coalesce((p_attr->>'limit')::integer,100);
   v_offset:=coalesce((p_attr->>'offset')::integer,0);
   IF v_limit NOT BETWEEN 1 AND 500 OR v_offset NOT BETWEEN 0 AND 100000
   THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
   IF p_attr ? 'where' AND pg_catalog.jsonb_typeof(p_attr->'where') <> 'object'
   THEN RAISE EXCEPTION 'Invalid attr filter' USING ERRCODE='22023'; END IF;
   EXECUTE pg_catalog.format($q$
     SELECT coalesce(pg_catalog.jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
     (SELECT uid,type,title,description,invisible,attr
      FROM %s WHERE type=$1 AND ($2 IS NULL OR uid=$2)
      AND ($3 OR (invisible IS FALSE AND $4))
      AND ($5::jsonb IS NULL OR attr @> $5::jsonb)
      ORDER BY uid LIMIT $6 OFFSET $7) x
   $q$,v_relation)
   INTO v_result USING v_type,v_uid,v_owner,v_is_public,p_attr->'where',v_limit,v_offset;
   RETURN v_result;
 END IF;
 IF NOT v_owner THEN RAISE EXCEPTION 'Scope write permission required' USING ERRCODE='42501'; END IF;
 IF v_op='link' THEN
   IF v_type<>'point' OR p_attr ? 'uid' OR p_attr ? 'data' OR
      NOT (p_attr ? 'updates') OR
      pg_catalog.jsonb_typeof(p_attr->'updates') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'Invalid Point links' USING ERRCODE='22023'; END IF;
   v_link_count:=silver.apply_scope_point_links(
     v_scope,p_attr->'updates',coalesce(p_attr->>'mode','place_id'));
   RETURN pg_catalog.jsonb_build_object('count',v_link_count);
 END IF;
 IF v_uid IS NULL THEN RAISE EXCEPTION 'UID required' USING ERRCODE='22023'; END IF;
 IF p_attr ? 'data' AND pg_catalog.jsonb_typeof(p_attr->'data') <> 'object'
 THEN RAISE EXCEPTION 'Anchor attr must be JSON object' USING ERRCODE='22023'; END IF;
 IF v_op='insert' THEN
   IF NOT p_attr ? 'data' THEN RAISE EXCEPTION 'data is required' USING ERRCODE='22023'; END IF;
   EXECUTE pg_catalog.format($q$
     INSERT INTO %s AS t(uid,type,title,description,invisible,attr)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(t)
   $q$,v_relation)
   INTO v_result USING v_uid,v_type,p_attr->>'title',p_attr->>'description',
   coalesce((p_attr->>'invisible')::boolean,false),p_attr->'data';
 ELSIF v_op IN ('update','patch') THEN
   IF v_op='patch' AND NOT (p_attr ? 'data') THEN
     RAISE EXCEPTION 'Patch data is required' USING ERRCODE='22023'; END IF;
   EXECUTE pg_catalog.format($q$
     UPDATE %s AS t SET
      title=CASE WHEN $3 THEN $4 ELSE t.title END,
      description=CASE WHEN $5 THEN $6 ELSE t.description END,
      invisible=CASE WHEN $7 THEN $8 ELSE t.invisible END,
      attr=CASE WHEN $9 THEN CASE WHEN $11 THEN t.attr || $10 ELSE $10 END ELSE t.attr END
     WHERE t.uid=$1 AND t.type=$2 RETURNING to_jsonb(t)
   $q$,v_relation) INTO v_result
   USING v_uid,v_type,
     p_attr ? 'title',p_attr->>'title',
     p_attr ? 'description',p_attr->>'description',
     p_attr ? 'invisible',(p_attr->>'invisible')::boolean,
     p_attr ? 'data',p_attr->'data',v_op='patch';
 ELSE
   -- Cross-reference/merge transactions must continue using their guarded dedicated RPCs.
   RAISE EXCEPTION 'Delete requires the dedicated reference-safe operation' USING ERRCODE='0A000';
 END IF;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'Anchor write affected % rows',v_rows USING ERRCODE='P0002'; END IF;
 RETURN v_result;
END $function$
;
DROP FUNCTION silver.read_scope_keyword_suggestions(text) RESTRICT;
DROP FUNCTION silver.trace_place_suggestions(text,integer) RESTRICT;
DROP FUNCTION silver.read_music_style_tree() RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
