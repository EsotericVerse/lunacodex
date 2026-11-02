BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
-- Native lrunes Anchor schema and deployed read RPCs, including 8-char UID.
-- No new table is created in an already-migrated environment.
-- The only indexes on a new Anchor are its UID primary key and existing standard type B-tree.
-- lrunes_daily remains a separate, unmodified table.
CREATE TABLE IF NOT EXISTS silver.lrunes_anchor(
  uid varchar(8) NOT NULL PRIMARY KEY,
  type text NOT NULL,
  title text,
  description text,
  invisible boolean NOT NULL DEFAULT false,
  attr jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS lrunes_anchor_type_idx ON silver.lrunes_anchor USING btree(type);
ALTER TABLE silver.lrunes_anchor ENABLE ROW LEVEL SECURITY;
DO $contract$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
    ('anchor_public_read', 'FOR SELECT TO anon USING (type IN (''date'',''period'',''era'',''point'',''path'',''trace'',''image'',''video'',''rune'',''suno'') AND invisible IS FALSE)'),
    ('anchor_member_read', 'FOR SELECT TO authenticated USING (silver.can_manage_scope(''lrunes'') OR (type IN (''date'',''period'',''era'',''point'',''path'',''trace'',''image'',''video'',''rune'',''suno'') AND invisible IS FALSE))'),
    ('anchor_owner_insert', 'FOR INSERT TO authenticated WITH CHECK (silver.can_manage_scope(''lrunes''))'),
    ('anchor_owner_update', 'FOR UPDATE TO authenticated USING (silver.can_manage_scope(''lrunes'')) WITH CHECK (silver.can_manage_scope(''lrunes''))'),
    ('anchor_owner_delete', 'FOR DELETE TO authenticated USING (silver.can_manage_scope(''lrunes''))')
 ) p(name,clause) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='silver'
       AND tablename='lrunes_anchor' AND policyname=r.name) THEN
     EXECUTE format('CREATE POLICY %I ON silver.lrunes_anchor %s',r.name,r.clause);
   END IF;
 END LOOP;
END $contract$;
GRANT SELECT ON silver.lrunes_anchor TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON silver.lrunes_anchor TO authenticated;
DO $constraints$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
    ('anchor_attr_keys_minimal_chk','CHECK (
CASE
    WHEN (type = ''date''::text) THEN ((attr ? ''date''::text) AND ((attr - ''date''::text) = ''{}''::jsonb))
    WHEN (type = ''period''::text) THEN ((attr ? ''uid''::text) AND (((attr - ''uid''::text) - ''date''::text) = ''{}''::jsonb))
    WHEN (type = ''era''::text) THEN ((attr ? ''period''::text) AND (((attr - ''period''::text) - ''date''::text) = ''{}''::jsonb))
    WHEN (type = ''point''::text) THEN ((((attr - ''longitude''::text) - ''latitude''::text) - ''location''::text) = ''{}''::jsonb)
    WHEN (type = ''path''::text) THEN ((attr - ''point''::text) = ''{}''::jsonb)
    WHEN (type = ''trace''::text) THEN (((attr - ''point''::text) - ''path''::text) = ''{}''::jsonb)
    WHEN (type = ANY (ARRAY[''category''::text, ''class''::text])) THEN ((attr ? ''uid''::text) AND ((attr - ''uid''::text) = ''{}''::jsonb))
    WHEN (type = ''group''::text) THEN ((attr ? ''uid''::text) AND (((attr - ''uid''::text) - ''total''::text) = ''{}''::jsonb))
    WHEN (type = ''item''::text) THEN ((attr ? ''keyword''::text) AND (((attr - ''keyword''::text) - ''total''::text) = ''{}''::jsonb))
    WHEN (type = ''rune''::text) THEN (((((attr - ''url''::text) - ''date''::text) - ''rune''::text) = ''{}''::jsonb) AND ((NOT (attr ? ''rune''::text)) OR (jsonb_typeof((attr -> ''rune''::text)) = ANY (ARRAY[''object''::text, ''array''::text]))))
    WHEN (type = ANY (ARRAY[''image''::text, ''video''::text, ''suno''::text])) THEN (((attr - ''url''::text) - ''date''::text) = ''{}''::jsonb)
    ELSE false
END)'),
    ('anchor_attrs_object_chk','CHECK ((jsonb_typeof(attr) = ''object''::text))'),
    ('anchor_type_check','CHECK ((type = ANY (ARRAY[''date''::text, ''period''::text, ''era''::text, ''point''::text, ''path''::text, ''trace''::text, ''image''::text, ''video''::text, ''rune''::text, ''suno''::text, ''category''::text, ''class''::text, ''group''::text, ''item''::text])))'),
    ('anchor_uid_eight_chk','CHECK (((uid)::text ~ ''^[A-Za-z0-9]{8}$''::text))')
 ) v(name,definition) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='silver.lrunes_anchor'::regclass
       AND conname=r.name) THEN
     EXECUTE format('ALTER TABLE silver.lrunes_anchor ADD CONSTRAINT %I %s',
        r.name,r.definition);
   END IF;
 END LOOP;
END $constraints$;
DO $verify$
BEGIN
 IF to_regclass('silver.lrunes_daily') IS NULL THEN RAISE EXCEPTION 'lrunes_daily must remain separate'; END IF;
 IF to_regclass('silver.lrunes_time') IS NOT NULL AND
   (SELECT count(*) FROM silver.lrunes_anchor) <>
   ((SELECT count(*) FROM silver.lrunes_time)+(SELECT count(*) FROM silver.lrunes_trace)
   +(SELECT count(*) FROM silver.lrunes_keywords)+(SELECT count(*) FROM silver.lrunes_galaxy_media))
 THEN RAISE EXCEPTION 'lrunes legacy/Anchor counts differ, do not cut over'; END IF;
END $verify$;
ALTER TABLE silver.lrunes ALTER COLUMN current_keyword_class_uid TYPE varchar(8);
-- Keep the existing one-line draw description, store original ordered rune spread in attr.rune.
UPDATE silver.lrunes_anchor a
 SET attr=jsonb_set(a.attr,'{rune}',m.meta_tags::jsonb,true)
 FROM silver.lrunes_galaxy_media m
 WHERE a.uid=m.uid AND a.type='rune' AND m.type='rune'
 AND nullif(btrim(m.meta_tags),'') IS NOT NULL AND NOT a.attr ? 'rune';
DO $rune$
BEGIN
 IF EXISTS(SELECT 1 FROM silver.lrunes_galaxy_media m
    LEFT JOIN silver.lrunes_anchor a USING(uid)
    WHERE m.type='rune' AND (a.uid IS NULL OR a.type<>'rune' OR
      a.attr->'rune' IS DISTINCT FROM m.meta_tags::jsonb))
 THEN RAISE EXCEPTION 'rune_ref metadata not completely preserved'; END IF;
END $rune$;

CREATE OR REPLACE FUNCTION silver.keyword_class_is_shared(p_scope_id text, p_class_uid text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_config regclass;
 v_meta jsonb;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
    OR p_class_uid !~ (CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN '^[A-Za-z0-9]{8}$' ELSE '^[A-Za-z0-9]{4}$' END) THEN RETURN false; END IF;
 v_config:=to_regclass(format('silver.%I',v_scope));
 IF v_config IS NULL THEN RETURN false; END IF;
 EXECUTE format('SELECT keyword_meta FROM %s WHERE id=$1',v_config)
   INTO v_meta USING v_scope;
 RETURN coalesce((v_meta->'class_shares'->>p_class_uid)::boolean,false);
END
$function$
;

CREATE OR REPLACE FUNCTION silver.new_keyword_tree_uid(p_scope text)
 RETURNS character varying
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  alphabet constant text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  candidate varchar(8);found boolean;legacy_class boolean;relation text;staging boolean;tries integer;
BEGIN
  staging:=to_regclass(format('silver.%I_keywords_v2',p_scope)) IS NOT NULL;
  relation:=CASE WHEN staging
    THEN format('silver.%I_keywords_v2',p_scope)
    ELSE format('silver.%I_keywords',p_scope) END;
  IF p_scope !~ '^[a-z][a-z0-9]{0,14}$' THEN RAISE EXCEPTION 'Invalid Scope'; END IF;
  IF to_regclass(format('silver.%I_anchor',p_scope)) IS NOT NULL THEN relation:=format('silver.%I_anchor',p_scope); staging:=false; END IF;
  FOR tries IN 1..120 LOOP
    SELECT string_agg(substr(alphabet,1+floor(random()*62)::integer,1),'' ORDER BY position)::varchar(8)
      INTO candidate FROM generate_series(1,CASE WHEN to_regclass(format('silver.%I_anchor',p_scope)) IS NOT NULL THEN 8 ELSE 4 END) n(position);
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE uid=$1)',relation)
      INTO found USING candidate;
    legacy_class:=false;
    IF staging THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM silver.%I_keywords WHERE class_uid=$1)',p_scope)
        INTO legacy_class USING candidate;
    END IF;
    IF NOT found AND NOT legacy_class THEN RETURN candidate; END IF;
  END LOOP;
  RAISE EXCEPTION 'Cannot allocate a unique Keyword UID';
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_keyword_tree_catalog(p_scope_id text, p_class_uid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
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
 IF v_scope IN ('lo3rwang','lrunes') THEN
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
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$') THEN RETURN '{}'::jsonb; END IF;
 IF NOT silver.can_manage_scope(v_scope) AND
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
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_keyword_tree_summary(p_scope_id text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_source text DEFAULT NULL::text, p_class_uid text DEFAULT NULL::text)
 RETURNS TABLE(kind text, item_key text, group_uid text, day text, hit_count bigint, document_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_config regclass;
 v_keywords regclass;
 v_keywords_source text;
 v_galaxy regclass;
 v_class text;
 v_current text;
 v_meta jsonb;
 v_old_done timestamptz;
 v_done timestamptz;
 v_public boolean:=false;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
   SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
   THEN RAISE EXCEPTION 'Invalid Scope'; END IF;
 v_config:=to_regclass(format('silver.%I',v_scope));
 IF v_scope IN ('lo3rwang','lrunes') THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 v_galaxy:=to_regclass(format('silver.%I_galaxy',v_scope));
 IF v_config IS NULL OR v_keywords IS NULL OR v_galaxy IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN RETURN; END IF;
 EXECUTE format('SELECT current_keyword_class_uid,keyword_meta,staticstime FROM %s WHERE id=$1',v_config)
 INTO v_current,v_meta,v_old_done USING v_scope;
 v_class:=coalesce(nullif(p_class_uid,''),v_current);
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$') THEN RETURN; END IF;
 IF v_meta->'by_class'->v_class->>'completedAt' IS NOT NULL THEN
   v_done:=(v_meta->'by_class'->v_class->>'completedAt')::timestamptz;
 ELSIF v_class=v_current AND v_meta->>'class_uid'=v_class THEN
   v_done:=v_old_done;
 END IF;
 IF v_done IS NULL THEN RETURN; END IF;
 IF NOT silver.can_manage_scope(v_scope) AND
   NOT silver.keyword_class_is_shared(v_scope,v_class) THEN RETURN; END IF;
 RETURN QUERY EXECUTE format($query$
   WITH clazz AS (SELECT uid,lists FROM %1$s WHERE type='class' AND uid=$1),
   groups AS MATERIALIZED (
     SELECT g.uid::text AS uid,g.name,g.lists,g.uid_lists,c.order_no
     FROM clazz
     CROSS JOIN LATERAL unnest(clazz.lists) WITH ORDINALITY c(uid,order_no)
     JOIN %1$s g ON g.uid=c.uid AND g.type='group'
   ), items AS MATERIALIZED (
     SELECT i.uid::text AS uid,g.uid::text AS group_uid,i.uid_lists
     FROM groups g
     CROSS JOIN LATERAL unnest(g.lists) iid(uid)
     JOIN %1$s i ON i.uid=iid.uid AND i.type='item'
   ), group_hits AS MATERIALIZED (
     SELECT g.uid AS group_uid,article.uid::text AS article_uid,article.date::text AS d
     FROM groups g
     CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(g.uid_lists->'uidlists',g.uid_lists->'articles','[]'::jsonb)) a(uid)
     JOIN %2$s article ON article.uid::text=a.uid
     WHERE (article.able->>'keywords')::boolean IS TRUE
      AND ($2 IS NULL OR article.date >= $2) AND ($3 IS NULL OR article.date <= $3)
      AND ($4 IS NULL OR article.site=$4)
   ), item_hits AS MATERIALIZED (
     SELECT i.uid AS item_uid,i.group_uid,article.uid::text AS article_uid,
       article.date::text AS d,CASE WHEN jsonb_typeof(h.entry)='string' THEN 1 ELSE (h.entry->>'times')::bigint END AS times, (i.uid_lists->>'total')::bigint AS total
     FROM items i
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.uid_lists->'uidlists',i.uid_lists->'hits','[]'::jsonb)) h(entry)
     JOIN %2$s article ON article.uid::text=CASE WHEN jsonb_typeof(h.entry)='string' THEN h.entry #>> '{}' ELSE h.entry->>'uid' END
     WHERE (article.able->>'keywords')::boolean IS TRUE
      AND ($2 IS NULL OR article.date >= $2) AND ($3 IS NULL OR article.date <= $3)
      AND ($4 IS NULL OR article.site=$4)
   )
   SELECT 'eligible',NULL,NULL,'',count(DISTINCT article_uid),count(DISTINCT article_uid) FROM group_hits
   UNION ALL
   SELECT 'class_day',NULL,group_uid,d,count(DISTINCT article_uid),count(DISTINCT article_uid)
    FROM group_hits GROUP BY group_uid,d
   UNION ALL
   SELECT 'item',item_uid,group_uid,'',
      (CASE WHEN $2 IS NULL AND $3 IS NULL AND $4 IS NULL THEN coalesce(max(total),sum(times)) ELSE sum(times) END)::bigint,
      count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY item_uid,group_uid
   UNION ALL
   SELECT 'item_day',item_uid,group_uid,d,sum(times)::bigint,count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY item_uid,group_uid,d
   UNION ALL
   SELECT 'keyword_all_day',NULL,NULL,d,count(DISTINCT article_uid),count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY d
   UNION ALL
   SELECT 'group_items_day',NULL,group_uid,d,count(DISTINCT article_uid),count(DISTINCT article_uid)
    FROM item_hits WHERE times>0 GROUP BY group_uid,d
 $query$,v_keywords_source,v_galaxy)
 USING v_class,p_start,p_end,nullif(p_source,'');
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_shared_keyword_classes(p_scope_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
 v_keywords regclass;
 v_keywords_source text;
 v_result jsonb;
 v_owner boolean;
 v_class_source text;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT EXISTS(
   SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
   THEN RETURN '[]'::jsonb; END IF;
 IF v_scope IN ('lo3rwang','lrunes') THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 IF v_keywords IS NULL THEN RETURN '[]'::jsonb; END IF;
 v_owner:=silver.can_manage_scope(v_scope);
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped) THEN
   v_class_source:=format('(SELECT uid::text AS uid,name FROM %s WHERE type=''class'')',v_keywords_source);
 ELSIF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=v_keywords AND attname='class_uid' AND attnum>0 AND NOT attisdropped) THEN
   -- Legacy Neon: Class UID exists, but the UID-linked Group/Item tree does not.
   v_class_source:=format('(SELECT DISTINCT ON (class_uid) class_uid::text AS uid,class_name AS name
     FROM %s WHERE class_uid IS NOT NULL ORDER BY class_uid,class_name)',v_keywords_source);
 ELSE RETURN '[]'::jsonb; END IF;
 EXECUTE format($query$
   SELECT coalesce(jsonb_agg(jsonb_build_object(
     'scopeId',$1,
     'classUid',c.uid,
     'name',c.name,
     'category',CASE WHEN $2 THEN c.uid::text
       ELSE encode(sha256(convert_to($1||':'||c.uid::text,'UTF8')),'hex') END
   ) ORDER BY c.uid),'[]'::jsonb)
   FROM %s c WHERE ($2 OR silver.keyword_class_is_shared($1,c.uid::text))
 $query$,v_class_source) INTO v_result USING v_scope,v_owner;
 RETURN coalesce(v_result,'[]'::jsonb);
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_trace_keyword_group_totals(p_scope_id text, p_place_ids text[], p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_source text DEFAULT NULL::text, p_class_uid text DEFAULT NULL::text)
 RETURNS TABLE(group_uid text, group_name text, document_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope text:=lower(btrim(coalesce(p_scope_id,'')));
  v_config regclass;
  v_galaxy regclass;
  v_keywords regclass;
 v_keywords_source text;
  v_class_uid text;
  v_current text;
  v_meta jsonb;
  v_old_ready timestamptz;
  v_ready timestamptz;
  v_public boolean:=false;
BEGIN
  IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR
     NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
     THEN RAISE EXCEPTION 'Invalid Scope'; END IF;
  IF p_place_ids IS NULL OR cardinality(p_place_ids)<1 OR cardinality(p_place_ids)>80
    THEN RAISE EXCEPTION 'Place UID list must have 1-80 items'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_place_ids) x WHERE x !~ ('^[0-9A-Za-z]{'||CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$'))
    THEN RAISE EXCEPTION 'Invalid Place UID'; END IF;
  v_config:=to_regclass(format('silver.%I',v_scope));
  v_galaxy:=to_regclass(format('silver.%I_galaxy',v_scope));
  IF v_scope IN ('lo3rwang','lrunes') THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
  IF v_config IS NULL OR v_galaxy IS NULL OR v_keywords IS NULL
    THEN RAISE EXCEPTION 'Missing Scope data'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid=v_keywords AND attname='uid' AND attnum>0 AND NOT attisdropped)
    THEN RETURN; END IF;
  EXECUTE format('SELECT current_keyword_class_uid,keyword_meta,staticstime FROM %s WHERE id=$1',v_config)
    INTO v_current,v_meta,v_old_ready USING v_scope;
  v_class_uid:=coalesce(nullif(p_class_uid,''),v_current);
  IF v_class_uid IS NULL OR v_class_uid !~ ('^[A-Za-z0-9]{'||CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN '8' ELSE '4' END||'}$') THEN RETURN; END IF;
  IF v_meta->'by_class'->v_class_uid->>'completedAt' IS NOT NULL THEN
    v_ready:=(v_meta->'by_class'->v_class_uid->>'completedAt')::timestamptz;
  ELSIF v_class_uid=v_current AND v_meta->>'class_uid'=v_class_uid THEN
    v_ready:=v_old_ready;
  END IF;
  IF v_ready IS NULL THEN RETURN; END IF;
  IF NOT silver.can_manage_scope(v_scope) AND
    NOT silver.keyword_class_is_shared(v_scope,v_class_uid) THEN RETURN; END IF;
  RETURN QUERY EXECUTE format($query$
    WITH cl AS (
      SELECT uid,lists FROM %1$s WHERE type='class' AND uid=$1
    ), groups AS (
      SELECT g.uid,g.name,g.uid_lists
      FROM cl c
      CROSS JOIN LATERAL unnest(c.lists) cid(value)
      JOIN %1$s g ON g.uid=cid.value AND g.type='group'
    ), articles AS MATERIALIZED (
      SELECT g.uid::text uid
      FROM %2$s g
      WHERE g.place_id=ANY($2) AND (g.able->>'keywords')::boolean IS TRUE
        AND TRUE
        AND ($3 IS NULL OR g.date >= $3)
        AND ($4 IS NULL OR g.date <= $4)
        AND ($5 IS NULL OR g.site=$5)
    )
    SELECT k.uid::text,k.name,count(DISTINCT a.uid)::bigint
    FROM groups k
    LEFT JOIN articles a ON (coalesce(k.uid_lists->'uidlists',k.uid_lists->'articles','[]'::jsonb)) ? a.uid
    GROUP BY k.uid,k.name
    ORDER BY k.name,k.uid
  $query$,v_keywords_source,v_galaxy)
  USING v_class_uid,p_place_ids,p_start,p_end,nullif(p_source,'');
END
$function$
;

CREATE OR REPLACE FUNCTION silver.read_scope_linked_media_count(p_scope_id text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_galaxy regclass;v_media regclass;v_count bigint:=0;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR (p_start IS NOT NULL AND p_end IS NOT NULL AND p_start>p_end)
 THEN RAISE EXCEPTION 'Invalid media count scope/range' USING errcode='22023'; END IF;
 v_galaxy:=to_regclass(format('silver.%I',v_scope||'_galaxy'));
 v_media:=CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN to_regclass(format('silver.%I_anchor',v_scope))
 ELSE to_regclass(format('silver.%I',v_scope||'_galaxy_media')) END;
 IF v_galaxy IS NULL OR v_media IS NULL THEN RETURN 0; END IF;
 EXECUTE format($q$
 SELECT count(*)::bigint
 FROM (
   SELECT DISTINCT unnest(g.media_link)::text AS uid
   FROM %1$s g
   WHERE (g.able->>'statics')::boolean AND g.content<>''
     AND ($1 IS NULL OR g.date >= $1)
     AND ($2 IS NULL OR g.date <= $2)
 ) refs
 WHERE EXISTS (
   SELECT 1 FROM %2$s m
   WHERE m.uid=refs.uid
     AND NOT coalesce(m.invisible,false)
     %3$s
 )
 $q$,v_galaxy,v_media,CASE WHEN v_scope IN ('lo3rwang','lrunes')
 THEN 'AND m.type IN (''image'',''video'',''rune'',''suno'')'
 ELSE '' END) INTO v_count USING p_start,p_end;
 RETURN coalesce(v_count,0);
END;$function$
;

CREATE OR REPLACE FUNCTION silver.read_loc_statistics(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  r record; v_scopes jsonb := '[]'::jsonb; v_rows jsonb := '[]'::jsonb; v_part jsonb;
  v_e date; v_earliest date;
begin
  for r in select id as scope_id, display_name from silver.manage
           where active and manage_role = 'scope' order by sort_order, id loop
    if r.scope_id !~ '^[a-z][a-z0-9]{0,14}$'
       or to_regclass(format('silver.%I', r.scope_id || '_galaxy')) is null
       or (case when r.scope_id IN ('lo3rwang','lrunes')
         then to_regclass(format('silver.%I_anchor',r.scope_id)) is null
         else to_regclass(format('silver.%I',r.scope_id||'_galaxy_media')) is null
       end) then
      continue;
    end if;
    v_scopes := v_scopes || jsonb_build_array(jsonb_build_object('scope_id', r.scope_id, 'display_name', r.display_name));
    select coalesce(jsonb_agg(jsonb_build_object('scope_id', r.scope_id, 'day', t.day, 'item_count', t.n) order by t.day), '[]'::jsonb)
      into v_part
      from (select s.day, sum(s.item_count)::integer as n
            from silver.read_scope_statistics(r.scope_id, p_start, p_end, false) s
            where s.kind = 'total' group by s.day) t;
    v_rows := v_rows || v_part;
    v_e := silver.read_scope_earliest(r.scope_id);
    if v_e is not null and (v_earliest is null or v_e < v_earliest) then v_earliest := v_e; end if;
  end loop;
  select min(record_date) into v_e from silver.lrunes_daily;
  if v_e is not null and (v_earliest is null or v_e < v_earliest) then v_earliest := v_e; end if;
  return jsonb_build_object('earliest', v_earliest, 'scopes', v_scopes, 'rows', v_rows);
end;
$function$
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
    RETURN silver.read_keyword_tree_catalog(v_scope,v_class);
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
       OR EXISTS(SELECT 1 FROM unnest(v_places) x WHERE ((v_scope IN ('lo3rwang','lrunes') AND x !~ '^[A-Za-z0-9]{8}$') OR (v_scope NOT IN ('lo3rwang','lrunes') AND x !~ '^[A-Za-z0-9]{4}$'))) THEN
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

CREATE OR REPLACE FUNCTION silver.read_trace_place_density(p_scope_id text, p_place_ids text[], p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_source text DEFAULT NULL::text)
 RETURNS TABLE(day date, category text, item_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
BEGIN
 IF p_scope_id NOT IN ('lo3rwang','lrunes') THEN
   RAISE EXCEPTION 'Unsupported Trace article Scope';
 END IF;
 IF p_place_ids IS NULL OR cardinality(p_place_ids)=0 THEN RETURN; END IF;
 IF cardinality(p_place_ids)>80 OR EXISTS(
    SELECT 1 FROM unnest(p_place_ids) AS id
    WHERE id IS NULL OR ((p_scope_id IN ('lo3rwang','lrunes') AND id !~ '^[A-Za-z0-9]{8}$') OR (p_scope_id NOT IN ('lo3rwang','lrunes') AND id !~ '^[A-Za-z0-9]{4}$'))
 ) THEN RAISE EXCEPTION 'Invalid Trace place IDs'; END IF;
 RETURN QUERY EXECUTE format($sql$
   SELECT (g.createtime AT TIME ZONE 'Asia/Taipei')::date AS day,
          g.place_id::text AS category,count(*)::bigint AS item_count
   FROM silver.%I AS g
   WHERE g.place_id=ANY($1) AND (g.able->>'trace')::boolean IS TRUE
     AND TRUE AND g.createtime IS NOT NULL
     AND ($2::date IS NULL OR g.createtime >=
       ($2::date::timestamp AT TIME ZONE 'Asia/Taipei'))
     AND ($3::date IS NULL OR g.createtime <
       (($3::date+1)::timestamp AT TIME ZONE 'Asia/Taipei'))
     AND ($4::text IS NULL OR g.site ILIKE $4)
   GROUP BY 1,2 ORDER BY 1,2
 $sql$,p_scope_id||'_galaxy')
 USING p_place_ids,p_start,p_end,p_source;
END;
$function$
;

CREATE OR REPLACE FUNCTION silver.save_archive_media_exif(p_scope_id text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_suffix text;
  v_media regclass;
  v_row jsonb;
  v_id varchar(8);
  v_lat double precision;
  v_lng double precision;
  v_time text;
  v_found boolean;
  v_count integer := 0;
begin
  if v_scope !~ '^[a-z][a-z0-9]{0,14}$' then raise exception 'invalid Scope ID'; end if;
  if not silver.can_manage_scope(v_scope) then raise exception 'Scope management permission denied'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'EXIF rows must be a JSON array with at most 10000 entries';
  end if;
  select coalesce(nullif(galaxy_table,''),'galaxy') into v_suffix
    from silver.manage where id=v_scope;
  if v_suffix is null then raise exception 'Scope mapping not found'; end if;
  v_media := CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN to_regclass(format('silver.%I_anchor',v_scope))
   ELSE to_regclass(format('silver.%I',v_scope||'_'||v_suffix||'_media')) END;
  if v_media is null then raise exception 'Scope Galaxy Media table not found'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(v_row->>'media_uid','');
    v_lat := nullif(v_row->>'latitude','')::double precision;
    v_lng := nullif(v_row->>'longitude','')::double precision;
    v_time := nullif(btrim(coalesce(v_row->>'camera_local_time','')),'');
    if nullif(v_row->>'archive_id','') is null or nullif(v_row->>'entry_path','') is null then
      raise exception 'EXIF archive identity required';
    end if;
    if length(v_row->>'archive_id')>400 or length(v_row->>'entry_path')>2048 then
      raise exception 'EXIF archive path exceeds limit';
    end if;
    if (v_lat is null) <> (v_lng is null) or
      (v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180)) then
      raise exception 'EXIF coordinates invalid';
    end if;
    if v_lat is null and v_time is null then continue; end if;
    if v_id is not null then
      execute format('select exists(select 1 from %s where uid=$1 %s)',v_media,
       CASE WHEN v_scope IN ('lo3rwang','lrunes') THEN 'AND type IN (''image'',''video'',''rune'',''suno'')' ELSE '' END)
        using v_id into v_found;
      if not v_found then raise exception 'EXIF media UID is not registered for this Scope'; end if;
    end if;
    insert into silver.archive_media_exif
      (scope_id,archive_id,entry_path,media_uid,platform,latitude,longitude,camera_local_time)
    values
      (v_scope,v_row->>'archive_id',v_row->>'entry_path',v_id,
       nullif(left(coalesce(v_row->>'platform',''),32),''),
       v_lat,v_lng,v_time)
    on conflict(scope_id,archive_id,entry_path)
      do update set media_uid=excluded.media_uid,
        platform=coalesce(excluded.platform,silver.archive_media_exif.platform),
        latitude=coalesce(excluded.latitude,silver.archive_media_exif.latitude),
        longitude=coalesce(excluded.longitude,silver.archive_media_exif.longitude),
        camera_local_time=coalesce(excluded.camera_local_time,silver.archive_media_exif.camera_local_time),
        imported_at=now();
    v_count := v_count+1;
  end loop;
  return v_count;
end
$function$
;
COMMIT;
