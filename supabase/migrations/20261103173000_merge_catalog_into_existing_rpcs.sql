-- Retire LOC Catalog and Keyword Catalog RPCs into existing canonical endpoints.
BEGIN;
CREATE OR REPLACE FUNCTION silver.loc_admin_settings(p_section text, p_operation text DEFAULT 'read'::text, p_key text DEFAULT NULL::text, p_value jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE old_rows jsonb; new_rows jsonb:='[]'::jsonb; rec jsonb; exists_row boolean:=false;
 k text:=btrim(coalesce(p_key,'')); new_data jsonb;
BEGIN
 IF p_section IN ('theme','keywords') THEN
 DECLARE
 p_action text:=p_operation;
 saved jsonb;
 next_rows jsonb := '[]'::jsonb;
 rec jsonb;
 previous jsonb;
 new_key jsonb;
 found_row boolean := false;
 id_text text := btrim(coalesce(p_key,''));
 new_scope text;
 new_name text;
 old_scope text;
 old_name text;
BEGIN
 IF NOT coalesce((SELECT allowed FROM silver.manage('global')),false) THEN
   RAISE EXCEPTION 'Global administrator required' USING ERRCODE='42501';
 END IF;
 IF p_section NOT IN ('theme','keywords') THEN
   RAISE EXCEPTION 'Unsupported LOC catalog';
 END IF;
 SELECT CASE WHEN p_section='theme' THEN l.theme ELSE l.keywords END
 INTO saved FROM silver.loc l WHERE l.id='loc' FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(saved)<>'array' THEN
   RAISE EXCEPTION 'LOC catalog is unavailable';
 END IF;
 IF p_action='read' THEN RETURN saved; END IF;
 IF p_section='theme' THEN
   IF p_action<>'upsert' OR id_text !~ '^[1-8]$'
      OR jsonb_typeof(p_value)<>'object'
      OR p_value->>'theme_id'<>id_text
      OR p_value->>'scheme' NOT IN ('light','dark')
      OR nullif(btrim(p_value->>'theme_name'),'') IS NULL THEN
     RAISE EXCEPTION 'Invalid Theme update';
   END IF;
   FOR rec IN SELECT value FROM jsonb_array_elements(saved) AS x(value) LOOP
     IF rec->>'theme_id'=id_text THEN
       found_row:=true;
       -- Require every existing palette property and reject extra properties.
       IF EXISTS(SELECT 1 FROM jsonb_object_keys(rec) AS x_key(key_name) WHERE NOT p_value ? x_key.key_name)
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) AS y_key(key_name) WHERE NOT rec ? y_key.key_name)
          OR EXISTS(SELECT 1 FROM jsonb_each_text(p_value) kv
            WHERE kv.key NOT IN ('theme_id','theme_order') AND
              (kv.value IS NULL OR btrim(kv.value)='' OR
               kv.value ~ '[;{}<>\\]' OR kv.value ~* 'url\s*\(|@import|!important')) THEN
         RAISE EXCEPTION 'Incomplete or unsafe Theme palette';
       END IF;
       next_rows:=next_rows||jsonb_build_array(p_value);
     ELSE next_rows:=next_rows||jsonb_build_array(rec); END IF;
   END LOOP;
   IF NOT found_row OR jsonb_array_length(next_rows)<>8 THEN
     RAISE EXCEPTION 'Theme slot missing or incomplete';
   END IF;
   UPDATE silver.loc SET theme=next_rows WHERE id='loc';
   RETURN p_value;
 END IF;
 IF p_action NOT IN ('upsert','delete') THEN
   RAISE EXCEPTION 'Invalid Keyword operation';
 END IF;
 IF p_key IS NOT NULL THEN
   BEGIN new_key:=p_key::jsonb;
   EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid Keyword identifier'; END;
   IF jsonb_typeof(new_key)<>'array' OR jsonb_array_length(new_key)<>2 THEN
     RAISE EXCEPTION 'Invalid Keyword identifier';
   END IF;
   old_scope:=new_key->>0;old_name:=new_key->>1;
 END IF;
 IF p_action='upsert' THEN
   IF jsonb_typeof(p_value)<>'object' THEN RAISE EXCEPTION 'Invalid Keyword record'; END IF;
   new_scope:=p_value->>'scope_id';new_name:=btrim(p_value->>'class_name');
   IF coalesce(new_scope,'') !~ '^[a-z][a-z0-9]{0,14}$' OR
       new_name IS NULL OR new_name='' OR length(new_name)>120 OR
       coalesce(p_value->>'hash','') !~ '^[0-9a-f]{32}$' THEN
     RAISE EXCEPTION 'Invalid Keyword registry fields';
   END IF;
 END IF;
 FOR rec IN SELECT value FROM jsonb_array_elements(saved) AS x(value) LOOP
   IF p_key IS NOT NULL AND rec->>'scope_id'=old_scope
      AND rec->>'class_name'=old_name THEN
     found_row:=true;
     IF p_action='upsert' THEN next_rows:=next_rows||jsonb_build_array(
       jsonb_build_object('scope_id',new_scope,'class_name',new_name,'hash',p_value->>'hash'));
     END IF;
   ELSE next_rows:=next_rows||jsonb_build_array(rec); END IF;
 END LOOP;
 IF p_action='delete' AND NOT found_row THEN RAISE EXCEPTION 'Keyword registry entry not found'; END IF;
 IF p_action='upsert' AND p_key IS NOT NULL AND NOT found_row THEN
   RAISE EXCEPTION 'Keyword registry entry not found';
 END IF;
 IF p_action='upsert' AND p_key IS NULL THEN
   next_rows:=next_rows||jsonb_build_array(jsonb_build_object(
     'scope_id',new_scope,'class_name',new_name,'hash',p_value->>'hash'));
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(next_rows) a
  GROUP BY a.value->>'scope_id',a.value->>'class_name' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Duplicate Scope and Keyword Class';
 END IF;
 UPDATE silver.loc SET keywords=next_rows WHERE id='loc';
 RETURN CASE WHEN p_action='delete' THEN '{"deleted":true}'::jsonb
   ELSE jsonb_build_object('scope_id',new_scope,'class_name',new_name,'hash',p_value->>'hash') END;
END;
 END IF;
 IF NOT coalesce((SELECT allowed FROM silver.manage('global')),false) THEN RAISE EXCEPTION 'Global administration required' USING ERRCODE='42501'; END IF;
 IF p_section NOT IN ('database','email','scopeid') THEN RAISE EXCEPTION 'Unknown settings section'; END IF;
 SELECT CASE WHEN p_section='database' THEN database ELSE blacklist->p_section END
 INTO old_rows FROM silver.loc WHERE id='loc' FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(old_rows)<>'array' THEN RAISE EXCEPTION 'LOC settings are missing'; END IF;
 IF p_operation='read' THEN RETURN old_rows; END IF;
 IF p_section='database' THEN
  IF p_operation NOT IN ('upsert','delete') OR k !~ '^[A-Za-z][A-Za-z0-9_-]{0,80}$'
   THEN RAISE EXCEPTION 'Invalid database action or target'; END IF;
  IF p_operation='upsert' AND (jsonb_typeof(p_value)<>'object' OR p_value->>'provider' NOT IN ('supabase','neon','custom')
    OR nullif(btrim(p_value->>'label'),'') IS NULL) THEN
   RAISE EXCEPTION 'Invalid database metadata'; END IF;
  FOR rec IN SELECT value FROM jsonb_array_elements(old_rows) LOOP
   IF rec->>'target_id'=k THEN
    exists_row:=true;
    IF p_operation='delete' THEN
     IF (rec->>'selected')::boolean IS TRUE OR (rec->>'backup_selected')::boolean IS TRUE
      THEN RAISE EXCEPTION 'Active routing targets cannot be deleted'; END IF;
    ELSE
     new_data:=(rec || (p_value - 'target_id' - 'selected' - 'backup_selected' - 'routing_mode'));
     new_rows:=new_rows||jsonb_build_array(new_data||jsonb_build_object('updated_at',now()));
    END IF;
   ELSE new_rows:=new_rows||jsonb_build_array(rec); END IF;
  END LOOP;
  IF p_operation='upsert' AND NOT exists_row THEN
   new_rows:=new_rows||jsonb_build_array(
     (p_value - 'selected' - 'backup_selected' - 'routing_mode' - 'target_id')
     || jsonb_build_object('target_id',k,'selected',false,'backup_selected',false,'routing_mode','single','updated_at',now()));
  ELSIF p_operation='delete' AND NOT exists_row THEN RAISE EXCEPTION 'Unknown database target'; END IF;
  UPDATE silver.loc SET database=new_rows WHERE id='loc';
 ELSE
  IF p_section='email' THEN
   k:=lower(k);
   IF k !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_operation NOT IN ('add','remove')
    THEN RAISE EXCEPTION 'Invalid email action'; END IF;
   IF p_operation='add' AND k=silver.current_auth_email() THEN
    RAISE EXCEPTION 'Current administrator cannot be blocked'; END IF;
   FOR rec IN SELECT value FROM jsonb_array_elements(old_rows) LOOP
    IF lower(rec->>'email')=k THEN
     exists_row:=true;
     IF p_operation='add' THEN new_rows:=new_rows||jsonb_build_array(rec); END IF;
    ELSE new_rows:=new_rows||jsonb_build_array(rec); END IF;
   END LOOP;
   IF p_operation='add' AND NOT exists_row THEN
    new_rows:=new_rows||jsonb_build_array(jsonb_build_object('email',k,'created_at',now()));
   END IF;
  ELSE
   IF p_operation<>'note' OR k='' THEN RAISE EXCEPTION 'Only reserved Scope notes may be edited'; END IF;
   FOR rec IN SELECT value FROM jsonb_array_elements(old_rows) LOOP
    IF rec->>'id'=k THEN
     exists_row:=true;
     new_rows:=new_rows||jsonb_build_array(rec||jsonb_build_object('note',nullif(btrim(coalesce(p_value #>> '{}','')),'')));
    ELSE new_rows:=new_rows||jsonb_build_array(rec); END IF;
   END LOOP;
   IF NOT exists_row THEN RAISE EXCEPTION 'Unknown reserved Scope ID'; END IF;
  END IF;
  UPDATE silver.loc SET blacklist=jsonb_set(blacklist,ARRAY[p_section],new_rows,true) WHERE id='loc';
 END IF;
 RETURN new_rows;
END $function$
;
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
 v_rows integer; v_is_public boolean; v_link_count integer;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
 OR v_type NOT IN ('date','period','era','point','path','trace','image','video','rune','suno','category','class','group','item')
 OR pg_catalog.jsonb_typeof(p_attr) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Invalid scope/type/attr' USING ERRCODE='22023'; END IF;
 v_op:=coalesce(p_attr->>'op','read');
 IF v_op NOT IN ('read','insert','update','patch','delete','link','catalog')
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
DROP FUNCTION silver.loc_catalog(text,text,text,jsonb) RESTRICT;
DROP FUNCTION silver.read_keyword_tree_catalog(text,text) RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;