BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
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
 v_rows integer; v_is_public boolean;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
 OR v_type NOT IN ('date','period','era','point','path','trace','image','video','rune','suno','category','class','group','item')
 OR pg_catalog.jsonb_typeof(p_attr) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Invalid scope/type/attr' USING ERRCODE='22023'; END IF;
 v_op:=coalesce(p_attr->>'op','read');
 IF v_op NOT IN ('read','insert','update','patch','delete')
 THEN RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_attr) k(key)
   WHERE k.key NOT IN ('op','uid','title','description','invisible','data','where','limit','offset'))
 THEN RAISE EXCEPTION 'Unknown JSONB request field' USING ERRCODE='22023'; END IF;
 SELECT anchor_table INTO v_suffix FROM silver.manage
 WHERE id=v_scope AND manage_role='scope' AND active IS TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive Scope' USING ERRCODE='22023'; END IF;
 v_relation:=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope||'_'||coalesce(nullif(v_suffix,''),'anchor')));
 IF v_relation IS NULL THEN RAISE EXCEPTION 'Scope Anchor not available' USING ERRCODE='22023'; END IF;
 v_uid:=p_attr->>'uid';
 IF v_uid IS NOT NULL AND v_uid !~ '^[A-Za-z0-9]{8}$'
 THEN RAISE EXCEPTION 'Invalid UID' USING ERRCODE='22023'; END IF;
 v_owner:=silver.can_manage_scope(v_scope);
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
COMMIT;
