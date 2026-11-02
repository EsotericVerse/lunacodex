-- Retire the four legacy manage RPCs after migrating every function and RLS caller.
-- The canonical authorization primitive remains silver.manage(type,id), typed rows.
BEGIN;
CREATE OR REPLACE FUNCTION silver.cleanup_galaxy_duplicates(p_scope_id text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope text := lower(btrim(coalesce(p_scope_id,'')));
  v_galaxy regclass;
  v_pairs jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_groups integer := 0;
  v_deleted integer := 0;
BEGIN
  IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' THEN
    RAISE EXCEPTION 'Invalid scope id' USING errcode='22023';
  END IF;
  IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) THEN
    RAISE EXCEPTION 'Management permission denied' USING errcode='42501';
  END IF;
  v_galaxy := to_regclass(format('silver.%I',v_scope||'_galaxy'));
  IF v_galaxy IS NULL THEN
    RAISE EXCEPTION 'Galaxy not found' USING errcode='22023';
  END IF;

  -- A single Galaxy-only grouping pass; no temporary table or date index.
  -- A matching timestamp alone is never sufficient to delete a post.
  -- Conflicting nonblank original IDs, URLs or curated place IDs are excluded.
  EXECUTE format($q$
    WITH eligible AS (
      SELECT lower(btrim(site)) AS site_key, createtime, content
      FROM %1$s
      WHERE nullif(btrim(site),'') IS NOT NULL
        AND createtime IS NOT NULL AND nullif(btrim(content),'') IS NOT NULL
      GROUP BY lower(btrim(site)),createtime,content
      HAVING count(*)>1
         AND count(DISTINCT nullif(btrim(site_id),''))<=1
         AND count(DISTINCT nullif(btrim(url),''))<=1
         AND count(DISTINCT nullif(btrim(place_id),''))<=1
    ),
    ranked AS (
      SELECT g.uid::text AS uid,
        first_value(g.uid::text) OVER w AS keep_uid,
        row_number() OVER w AS rn
      FROM %1$s g JOIN eligible e
        ON e.site_key=lower(btrim(g.site))
       AND e.createtime=g.createtime AND e.content=g.content
      WINDOW w AS (
        PARTITION BY lower(btrim(g.site)),g.createtime,g.content
        ORDER BY
          (CASE WHEN nullif(btrim(g.place_id),'') IS NOT NULL THEN 8 ELSE 0 END+
           CASE WHEN nullif(btrim(g.location),'') IS NOT NULL THEN 2 ELSE 0 END+
           CASE WHEN nullif(btrim(g.url),'') IS NOT NULL THEN 2 ELSE 0 END+
           CASE WHEN nullif(btrim(g.site_id),'') IS NOT NULL THEN 2 ELSE 0 END+
           coalesce(cardinality(g.media_link),0)*2) DESC,
          g."UpdateTime" ASC NULLS LAST,g.uid ASC
      )
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('discard',uid,'keep',keep_uid)),'[]'::jsonb)
    FROM ranked WHERE rn>1
  $q$,v_galaxy) INTO v_pairs;
  v_count := jsonb_array_length(v_pairs);
  SELECT count(DISTINCT v->>'keep') INTO v_groups
    FROM jsonb_array_elements(v_pairs) AS v;
  IF coalesce(p_dry_run,true) OR v_count=0 THEN
    RETURN jsonb_build_object('groups',v_groups,'duplicates',v_count,'deleted',0,'dry_run',true);
  END IF;

  -- Merge valuable metadata and all media links into the keeper BEFORE deletion.
  EXECUTE format($q$
    WITH pairs AS (
      SELECT p->>'discard' AS discard_uid,p->>'keep' AS keep_uid
      FROM jsonb_array_elements($1) AS p
    )
    UPDATE %1$s k SET
      media_link=coalesce((
        SELECT array_agg(DISTINCT v.media)::varchar[]
        FROM %1$s other
        CROSS JOIN LATERAL unnest(coalesce(other.media_link,array[]::varchar[])) AS v(media)
        WHERE other.uid=k.uid OR other.uid::text IN
          (SELECT discard_uid FROM pairs WHERE keep_uid=k.uid::text)
      ),k.media_link),
      target_id=coalesce((
        SELECT array_agg(DISTINCT v.target)::text[]
        FROM %1$s other
        CROSS JOIN LATERAL unnest(coalesce(other.target_id,array[]::text[])) AS v(target)
        WHERE other.uid=k.uid OR other.uid::text IN
          (SELECT discard_uid FROM pairs WHERE keep_uid=k.uid::text)
      ),k.target_id),
      place_id=coalesce(nullif(btrim(k.place_id),''),(
        SELECT nullif(btrim(other.place_id),'') FROM %1$s other JOIN pairs p
          ON other.uid::text=p.discard_uid WHERE p.keep_uid=k.uid::text
          AND nullif(btrim(other.place_id),'') IS NOT NULL LIMIT 1)),
      location=coalesce(nullif(btrim(k.location),''),(
        SELECT nullif(btrim(other.location),'') FROM %1$s other JOIN pairs p
          ON other.uid::text=p.discard_uid WHERE p.keep_uid=k.uid::text
          AND nullif(btrim(other.location),'') IS NOT NULL LIMIT 1)),
      site_id=coalesce(nullif(btrim(k.site_id),''),(
        SELECT nullif(btrim(other.site_id),'') FROM %1$s other JOIN pairs p
          ON other.uid::text=p.discard_uid WHERE p.keep_uid=k.uid::text
          AND nullif(btrim(other.site_id),'') IS NOT NULL LIMIT 1)),
      url=coalesce(nullif(btrim(k.url),''),(
        SELECT nullif(btrim(other.url),'') FROM %1$s other JOIN pairs p
          ON other.uid::text=p.discard_uid WHERE p.keep_uid=k.uid::text
          AND nullif(btrim(other.url),'') IS NOT NULL LIMIT 1))
    WHERE k.uid::text IN (SELECT DISTINCT keep_uid FROM pairs)
  $q$,v_galaxy) USING v_pairs;

  -- Fix all Galaxy UID pointers so parent/child relations survive cleanup.
  EXECUTE format($q$
    WITH pairs AS (
      SELECT p->>'discard' AS discard_uid,p->>'keep' AS keep_uid
      FROM jsonb_array_elements($1) AS p
    )
    UPDATE %1$s g SET source_id=p.keep_uid::char(8)
      FROM pairs p WHERE g.source_id::text=p.discard_uid
  $q$,v_galaxy) USING v_pairs;
  EXECUTE format($q$
    WITH pairs AS (
      SELECT p->>'discard' AS discard_uid,p->>'keep' AS keep_uid
      FROM jsonb_array_elements($1) AS p
    )
    UPDATE %1$s g SET ref_id=p.keep_uid::char(8)
      FROM pairs p WHERE g.ref_id::text=p.discard_uid
  $q$,v_galaxy) USING v_pairs;
  EXECUTE format($q$
    WITH pairs AS (
      SELECT p->>'discard' AS discard_uid,p->>'keep' AS keep_uid
      FROM jsonb_array_elements($1) AS p
    )
    UPDATE %1$s g SET target_id=(
      SELECT array_agg(DISTINCT coalesce(p.keep_uid,t.id))::text[]
      FROM unnest(g.target_id) AS t(id)
      LEFT JOIN pairs p ON p.discard_uid=t.id
    )
    WHERE g.target_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(g.target_id) AS t(id)
      JOIN pairs p ON p.discard_uid=t.id
    )
  $q$,v_galaxy) USING v_pairs;

  EXECUTE format($q$
    DELETE FROM %1$s g
    USING jsonb_array_elements($1) AS p
    WHERE g.uid::text=p->>'discard'
  $q$,v_galaxy) USING v_pairs;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted<>v_count THEN
    RAISE EXCEPTION 'Duplicate cleanup count mismatch: expected %, deleted %',v_count,v_deleted;
  END IF;
  RETURN jsonb_build_object('groups',v_groups,'duplicates',v_count,'deleted',v_deleted,'dry_run',false);
END;
$function$
;
CREATE OR REPLACE FUNCTION silver.read_scope_keyword_suggestions(p_scope_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_cols boolean;v_rows text[];
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
 OR NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
 OR NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false)
 THEN RAISE EXCEPTION 'Scope permission denied' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
 WHERE attrelid=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope))
 AND attname='keyword_suggestions' AND attnum>0 AND NOT attisdropped) INTO v_cols;
 IF NOT v_cols THEN RETURN ARRAY[]::text[]; END IF;
 EXECUTE pg_catalog.format('SELECT keyword_suggestions FROM silver.%I WHERE id=$1',v_scope)
 INTO v_rows USING v_scope;
 RETURN coalesce(v_rows,ARRAY[]::text[]);
END $function$
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
  IF EXISTS(SELECT 1 FROM unnest(p_place_ids) x WHERE x !~ ('^[0-9A-Za-z]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$'))
    THEN RAISE EXCEPTION 'Invalid Place UID'; END IF;
  v_config:=to_regclass(format('silver.%I',v_scope));
  v_galaxy:=to_regclass(format('silver.%I_galaxy',v_scope));
  IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
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
  IF v_class_uid IS NULL OR v_class_uid !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN; END IF;
  IF v_meta->'by_class'->v_class_uid->>'completedAt' IS NOT NULL THEN
    v_ready:=(v_meta->'by_class'->v_class_uid->>'completedAt')::timestamptz;
  ELSIF v_class_uid=v_current AND v_meta->>'class_uid'=v_class_uid THEN
    v_ready:=v_old_ready;
  END IF;
  IF v_ready IS NULL THEN RETURN; END IF;
  IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) AND
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
CREATE OR REPLACE FUNCTION silver.trace_place_suggestions(p_scope_id text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_galaxy regclass;v_found boolean;v_result jsonb;
BEGIN
 IF nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL
 OR v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false)
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
END $function$
;
CREATE OR REPLACE FUNCTION silver.read_group_members(p_group_id text)
 RETURNS TABLE(id text, display_name text, parent_scope_id text, active boolean, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select m.id,m.display_name,m.parent_scope_id,m.active,m.sort_order
 from silver.manage m
 where coalesce((SELECT allowed FROM silver.manage('group',p_group_id)),false)
   and m.parent_scope_id=lower(btrim(p_group_id))
   and m.manage_role='scope'
 order by m.sort_order,m.id
$function$
;
CREATE OR REPLACE FUNCTION silver.update_group_member_name(p_group_id text, p_member_id text, p_display_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_group text:=lower(btrim(coalesce(p_group_id,'')));
 v_member text:=lower(btrim(coalesce(p_member_id,'')));
 v_name text:=btrim(coalesce(p_display_name,''));
begin
 if not coalesce((SELECT allowed FROM silver.manage('group',v_group)),false) then
   raise exception 'group management permission denied';
 end if;
 if v_name='' or length(v_name)>120 then
   raise exception 'member display name must have 1-120 characters';
 end if;
 if not exists(select 1 from silver.manage m where m.id=v_member
     and m.parent_scope_id=v_group and m.manage_role='scope') then
   raise exception 'member is outside this group';
 end if;
 if to_regclass(format('silver.%I',v_member)) is null then
   raise exception 'member configuration is unavailable';
 end if;
 execute format('update silver.%I set display_name=$1,updated_at=now() where id=$2',
      v_member) using v_name,v_member;
 if not found then raise exception 'member configuration not updated'; end if;
 update silver.manage set display_name=v_name,updated_at=now()
 where id=v_member and parent_scope_id=v_group and manage_role='scope';
 return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION silver.update_group_default_article_class(p_group_id text, p_names text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id text := lower(btrim(coalesce(p_group_id,'')));
BEGIN
  IF NOT coalesce((SELECT allowed FROM silver.manage('group',v_id)),false) THEN
    RAISE EXCEPTION 'group management permission denied';
  END IF;
  IF v_id <> 'loc' THEN
    RAISE EXCEPTION 'only LOC group classification is implemented';
  END IF;
  PERFORM 1 FROM silver.loc WHERE id=v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group config not found';
  END IF;
  IF p_names IS NULL
     OR EXISTS (
       SELECT 1 FROM unnest(p_names) AS s(name)
       WHERE s.name IS NULL OR length(btrim(s.name)) NOT BETWEEN 1 AND 80
     )
     OR cardinality(p_names) <> (
       SELECT count(DISTINCT lower(btrim(s.name)))
       FROM unnest(p_names) AS s(name)
     )
  THEN
    RAISE EXCEPTION 'classification names must be distinct and contain 1 to 80 characters';
  END IF;
  UPDATE silver.loc SET "DefaultArticleClass"=to_jsonb(p_names) WHERE id=v_id;
  RETURN TRUE;
END;
$function$
;
CREATE OR REPLACE FUNCTION silver.read_scope_registry_admin()
 RETURNS TABLE(id text, display_name text, email text, manage_role text, domain text, directory text, parent_scope_id text, active boolean, sort_order integer, galaxy_table text, anchor_table text, birthday date, title_tw text, desc_tw text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT l.id,l.display_name,l.email,l.manage_role,l.domain,l.directory,
 l.parent_scope_id,l.active,l.sort_order,l.galaxy_table,l.anchor_table,
 l.birthday,l.title_tw,l.desc_tw
 FROM silver.manage AS l
 WHERE coalesce((SELECT allowed FROM silver.manage('global')),false)
 ORDER BY l.sort_order,l.id;
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
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
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
 IF v_class IS NULL OR v_class !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN RETURN; END IF;
 IF v_meta->'by_class'->v_class->>'completedAt' IS NOT NULL THEN
   v_done:=(v_meta->'by_class'->v_class->>'completedAt')::timestamptz;
 ELSIF v_class=v_current AND v_meta->>'class_uid'=v_class THEN
   v_done:=v_old_done;
 END IF;
 IF v_done IS NULL THEN RETURN; END IF;
 IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) AND
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
CREATE OR REPLACE FUNCTION silver.rename_scope_site_batch(p_scope_id text, p_before text, p_after text, p_batch_size integer DEFAULT 1000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_galaxy regclass; v_affected integer;
BEGIN
  IF auth.uid() IS NULL OR coalesce(p_scope_id,'') !~ '^[a-z][a-z0-9]{0,14}$'
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
CREATE OR REPLACE FUNCTION silver.loc_catalog(p_section text, p_action text DEFAULT 'read'::text, p_key text DEFAULT NULL::text, p_value jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE
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
       IF EXISTS(SELECT 1 FROM jsonb_object_keys(rec) k WHERE NOT p_value ? k)
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT rec ? k)
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
 IF v_op NOT IN ('read','insert','update','patch','delete','link')
 THEN RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_attr) k(key)
   WHERE k.key NOT IN ('op','uid','title','description','invisible','data','where','limit','offset','updates','mode'))
 THEN RAISE EXCEPTION 'Unknown JSONB request field' USING ERRCODE='22023'; END IF;
 SELECT anchor_table INTO v_suffix FROM silver.manage
 WHERE id=v_scope AND manage_role='scope' AND active IS TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive Scope' USING ERRCODE='22023'; END IF;
 v_relation:=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope||'_'||coalesce(nullif(v_suffix,''),'anchor')));
 IF v_relation IS NULL THEN RAISE EXCEPTION 'Scope Anchor not available' USING ERRCODE='22023'; END IF;
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
  if not coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false) then raise exception 'Scope management permission denied'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'EXIF rows must be a JSON array with at most 10000 entries';
  end if;
  select coalesce(nullif(galaxy_table,''),'galaxy') into v_suffix
    from silver.manage where id=v_scope;
  if v_suffix is null then raise exception 'Scope mapping not found'; end if;
  v_media := CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN to_regclass(format('silver.%I_anchor',v_scope))
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
       CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN 'AND type IN (''image'',''video'',''rune'',''suno'')' ELSE '' END)
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
CREATE OR REPLACE FUNCTION silver.import_shared_keyword_class(p_target_scope text, p_source_scope text, p_class_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_to text:=lower(btrim(coalesce(p_target_scope,'')));
 v_from text:=lower(btrim(coalesce(p_source_scope,'')));
 v_uid text:=coalesce(p_class_uid,'');
 v_source regclass;
 v_source_sql text;
 v_target regclass;
 v_class record;
 v_group record;
 v_item record;
 v_group_link record;
 v_item_link record;
 v_root text;
 v_group_uid text;
 v_item_uid text;
 v_group_ids text[]:='{}'::text[];
 v_item_ids text[];
 v_group_count int:=0;
 v_item_count int:=0;
BEGIN
 IF v_to !~ '^[a-z][a-z0-9]{0,14}$'
    OR v_from !~ '^[a-z][a-z0-9]{0,14}$'
    OR v_uid !~ ('^[A-Za-z0-9]{'||CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_from)) IS NOT NULL THEN '8' ELSE '4' END||'}$') THEN
   RAISE EXCEPTION 'Invalid Scope or Class UID' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM silver.manage
   WHERE id=v_to AND manage_role='scope' AND active)
   OR NOT EXISTS(SELECT 1 FROM silver.manage
   WHERE id=v_from AND manage_role='scope' AND active) THEN
   RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='22023';
 END IF;
 IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_to)),false) THEN
   RAISE EXCEPTION 'Target Scope management permission required' USING ERRCODE='42501';
 END IF;
 IF NOT silver.keyword_class_is_shared(v_from,v_uid) THEN
   RAISE EXCEPTION 'Source Class is not publicly shared' USING ERRCODE='42501';
 END IF;
 v_source:=CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_from)) IS NOT NULL THEN to_regclass(format('silver.%I_anchor',v_from))
   ELSE to_regclass(format('silver.%I_keywords',v_from)) END;
 v_source_sql:=CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_from)) IS NOT NULL
   THEN format('(SELECT uid,type,title AS name,description AS "desc",ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists,invisible FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_from)
   ELSE v_source::text END;
 v_target:=CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL THEN to_regclass(format('silver.%I_anchor',v_to))
   ELSE to_regclass(format('silver.%I_keywords',v_to)) END;
 IF v_source IS NULL OR v_target IS NULL THEN
   RAISE EXCEPTION 'Keywords table unavailable' USING ERRCODE='22023';
 END IF;
 EXECUTE format('SELECT uid,name,"desc",lists,invisible FROM %s WHERE uid=$1 AND type=$2',v_source_sql)
   INTO v_class USING v_uid,'class';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Only an existing Class UID may be imported' USING ERRCODE='22023';
 END IF;
 -- A concurrent import to the same target cannot allocate conflicting UIDs.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_to),17148);
 FOR v_group_link IN SELECT unnest(v_class.lists) AS uid LOOP
   EXECUTE format('SELECT uid,name,"desc",lists,invisible FROM %s WHERE uid=$1 AND type=$2',v_source_sql)
     INTO v_group USING v_group_link.uid,'group';
   IF NOT FOUND THEN
     RAISE EXCEPTION 'Source Class references an invalid Group' USING ERRCODE='22023';
   END IF;
   v_item_ids:='{}'::text[];
   FOR v_item_link IN SELECT unnest(v_group.lists) AS uid LOOP
     EXECUTE format('SELECT uid,name,"desc",lists,invisible FROM %s WHERE uid=$1 AND type=$2',v_source_sql)
       INTO v_item USING v_item_link.uid,'item';
     IF NOT FOUND THEN
       RAISE EXCEPTION 'Source Group references an invalid Item' USING ERRCODE='22023';
     END IF;
     v_item_uid:=silver.new_keyword_tree_uid(v_to);
     EXECUTE (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
       USING v_item_uid,'item',v_item.name,v_item."desc",v_item.lists,CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL THEN '{"total":0,"uidlists":[]}'::jsonb ELSE '{"hits":[]}'::jsonb END,v_item.invisible;
     v_item_ids:=array_append(v_item_ids,v_item_uid);
     v_item_count:=v_item_count+1;
   END LOOP;
   v_group_uid:=silver.new_keyword_tree_uid(v_to);
   EXECUTE (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
     USING v_group_uid,'group',v_group.name,v_group."desc",v_item_ids,CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL THEN '{"total":0,"uidlists":[]}'::jsonb ELSE '{"articles":[]}'::jsonb END,v_group.invisible;
   v_group_ids:=array_append(v_group_ids,v_group_uid);
   v_group_count:=v_group_count+1;
 END LOOP;
 v_root:=silver.new_keyword_tree_uid(v_to);
 EXECUTE (CASE WHEN pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_to)) IS NOT NULL
   THEN format('INSERT INTO silver.%I_anchor(uid,type,title,description,attr,invisible) VALUES($1,$2,$3,$4,(jsonb_build_object(CASE WHEN $2=''item'' THEN ''keyword'' ELSE ''uid'' END,to_jsonb($5::text[])) || CASE WHEN $2 IN (''group'',''item'') THEN jsonb_build_object(''total'',coalesce(($6::jsonb->>''total'')::integer,0)) ELSE ''{}''::jsonb END),$7)',v_to)
   ELSE format('INSERT INTO %s(uid,type,name,"desc",lists,uid_lists,invisible) VALUES($1,$2,$3,$4,$5,$6,$7)',v_target)
 END)
   USING v_root,'class',v_class.name,v_class."desc",v_group_ids,'{}'::jsonb,v_class.invisible;
 -- Deliberately no Category insert: Category is owned by Scope Group.
 RETURN jsonb_build_object('scopeid',v_to,'uid',v_root,
   'source_scopeid',v_from,'source_uid',v_uid,
   'group_count',v_group_count,'item_count',v_item_count);
END
$function$
;
CREATE OR REPLACE FUNCTION silver.loc_admin_settings(p_section text, p_operation text DEFAULT 'read'::text, p_key text DEFAULT NULL::text, p_value jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE old_rows jsonb; new_rows jsonb:='[]'::jsonb; rec jsonb; exists_row boolean:=false;
 k text:=btrim(coalesce(p_key,'')); new_data jsonb;
BEGIN
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
CREATE OR REPLACE FUNCTION silver.refresh_scope_search_summary(p_scope_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE
  v_id text := lower(btrim(coalesce(p_scope_id,'')));
  v_galaxy regclass;
  v_count bigint;
  v_words bigint;
  v_start date;
  v_end date;
  v_now timestamptz := clock_timestamp();
  v_snapshot jsonb;
  v_rows integer;
BEGIN
  IF v_id !~ '^[a-z][a-z0-9]{0,14}$' THEN
    RAISE EXCEPTION 'Invalid article Scope ID' USING errcode='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM silver.manage WHERE id=v_id
                 AND manage_role='scope' AND active IS TRUE) THEN
    RAISE EXCEPTION 'Unknown or inactive article Scope' USING errcode='22023';
  END IF;
  IF NOT coalesce((SELECT allowed FROM silver.manage('scope',v_id)),false) THEN
    RAISE EXCEPTION 'Not authorized to refresh this Scope' USING errcode='42501';
  END IF;
  v_galaxy:=to_regclass(format('silver.%I',v_id||'_galaxy'));
  IF v_galaxy IS NULL THEN
    RAISE EXCEPTION 'Scope Galaxy unavailable' USING errcode='22023';
  END IF;
  EXECUTE format($q$
    SELECT count(*)::bigint,
      coalesce(sum(char_length(regexp_replace(regexp_replace(content,'<[^>]*>','','g'),
        '[[:space:]　]+','','g'))),0)::bigint,
      min(coalesce(date,(createtime at time zone 'Asia/Taipei')::date)),
      max(coalesce(date,(createtime at time zone 'Asia/Taipei')::date))
    FROM %s
    WHERE (able->>'search')::boolean IS TRUE
      AND nullif(btrim(content),'') IS NOT NULL
  $q$,v_galaxy)
  INTO v_count,v_words,v_start,v_end;
  v_snapshot:=jsonb_build_object(
    'article_count',v_count,'word_count',v_words,
    'first_date',v_start,'last_date',v_end,'refreshed_at',v_now
  );
  EXECUTE format(
    'UPDATE silver.%I SET status=jsonb_set(coalesce(status,''{}''::jsonb),''{search}'',$1,true) WHERE id=$2',
    v_id)
  USING v_snapshot,v_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Scope status was not updated' USING errcode='22023';
  END IF;
  RETURN jsonb_build_object('scope_id',v_id)||v_snapshot;
END;
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
 IF pg_catalog.to_regclass(pg_catalog.format('silver.%I_anchor',v_scope)) IS NOT NULL THEN
  v_keywords:=to_regclass(format('silver.%I_anchor',v_scope));
  v_keywords_source:=format('(SELECT uid, type, title AS name, description AS "desc", ARRAY(SELECT jsonb_array_elements_text(CASE WHEN type=''item'' THEN coalesce(attr->''keyword'',''[]''::jsonb) ELSE coalesce(attr->''uid'',''[]''::jsonb) END)) AS lists, attr AS uid_lists FROM silver.%I_anchor WHERE type IN (''category'',''class'',''group'',''item''))',v_scope);
 ELSE
  v_keywords:=to_regclass(format('silver.%I_keywords',v_scope));
  v_keywords_source:=v_keywords::text;
 END IF;
 IF v_keywords IS NULL THEN RETURN '[]'::jsonb; END IF;
 v_owner:=coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false);
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
CREATE OR REPLACE FUNCTION silver.save_scope_trace_place_names(p_scope_id text, p_uid character varying, p_names text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'silver'
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_anchor regclass;
 v_location jsonb;v_names text[];v_count integer;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false)
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
  IF auth.uid() IS NULL OR p_scope_id IS NULL
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
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
  OR NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false)
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
CREATE OR REPLACE FUNCTION silver.apply_scope_point_links(p_scope_id text, p_updates jsonb, p_mode text DEFAULT 'place_id'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_anchor regclass;v_galaxy regclass;v_suffix text;
v_total int;v_eligible int;v_affected int;
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$' OR NOT coalesce((SELECT allowed FROM silver.manage('scope',v_scope)),false)
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
END $function$
;
ALTER POLICY "lo3rwang_scope_update" ON silver."lo3rwang" USING (coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false));
ALTER POLICY "lo3rwang_galaxy_scope_update" ON silver."lo3rwang_galaxy" USING (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope)) WITH CHECK (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope));
ALTER POLICY "lrunes_scope_update" ON silver."lrunes" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "lrunes_daily_scope_delete" ON silver."lrunes_daily" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "lrunes_daily_scope_insert" ON silver."lrunes_daily" WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "lrunes_daily_scope_update" ON silver."lrunes_daily" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "runes_scope_update" ON silver."runes" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "anchor_owner_update" ON silver."lrunes_anchor" USING (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope)) WITH CHECK (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope));
ALTER POLICY "lrunes_galaxy_scope_update" ON silver."lrunes_galaxy" USING (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope)) WITH CHECK (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope));
ALTER POLICY "lo3rwang_blocks_scope_insert" ON silver."lo3rwang_blocks" WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false));
ALTER POLICY "lo3rwang_blocks_scope_update" ON silver."lo3rwang_blocks" USING (coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false));
ALTER POLICY "lo3rwang_blocks_scope_delete" ON silver."lo3rwang_blocks" USING (coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false));
ALTER POLICY "loc_blocks_admin_insert" ON silver."loc_blocks" WITH CHECK (coalesce((SELECT allowed FROM silver.manage('global')),false));
ALTER POLICY "game_scope_insert" ON silver."game" WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "game_scope_update" ON silver."game" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "game_scope_delete" ON silver."game" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "loc_blocks_admin_update" ON silver."loc_blocks" USING (coalesce((SELECT allowed FROM silver.manage('global')),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('global')),false));
ALTER POLICY "loc_blocks_admin_delete" ON silver."loc_blocks" USING (coalesce((SELECT allowed FROM silver.manage('global')),false));
ALTER POLICY "lrunes_blocks_scope_insert" ON silver."lrunes_blocks" WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "lrunes_blocks_scope_update" ON silver."lrunes_blocks" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "lrunes_blocks_scope_delete" ON silver."lrunes_blocks" USING (coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false));
ALTER POLICY "loc_manager_select" ON silver."loc" USING (((id = 'loc'::text) OR coalesce((SELECT allowed FROM silver.manage('global')),false)));
ALTER POLICY "lrunes_galaxy_authenticated_read" ON silver."lrunes_galaxy" USING (((((able ->> 'search'::text))::boolean IS TRUE) OR ( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope)));
ALTER POLICY "manage_admin_write" ON silver."manage" USING (coalesce((SELECT allowed FROM silver.manage('global')),false)) WITH CHECK (coalesce((SELECT allowed FROM silver.manage('global')),false));
ALTER POLICY "anchor_member_read" ON silver."lo3rwang_anchor" USING ((( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope) OR ((type = ANY (ARRAY['date'::text, 'period'::text, 'era'::text, 'point'::text, 'path'::text, 'trace'::text, 'image'::text, 'video'::text, 'rune'::text, 'suno'::text])) AND (invisible = false))));
ALTER POLICY "loc_next_admin_update" ON silver."loc" USING (((id = 'loc'::text) AND coalesce((SELECT allowed FROM silver.manage('global')),false))) WITH CHECK (((id = 'loc'::text) AND coalesce((SELECT allowed FROM silver.manage('global')),false)));
ALTER POLICY "lo3rwang_galaxy_authenticated_read" ON silver."lo3rwang_galaxy" USING ((( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope) OR ((((able ->> 'search'::text))::boolean IS TRUE) AND (lower(COALESCE(site, ''::text)) <> ALL (ARRAY['messenger'::text, 'chatgpt'::text, 'claude'::text, 'gemini'::text, 'msn'::text, 'whatsapp'::text, 'telegram'::text, 'discord'::text, 'line'::text, 'wechat'::text, 'teams'::text, 'copilot'::text, 'grok'::text, 'perplexity'::text, 'meta ai'::text, 'meta-ai'::text])))));
ALTER POLICY "anchor_member_read" ON silver."lrunes_anchor" USING ((( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope) OR ((type = ANY (ARRAY['date'::text, 'period'::text, 'era'::text, 'point'::text, 'path'::text, 'trace'::text, 'image'::text, 'video'::text, 'rune'::text, 'suno'::text])) AND (invisible IS FALSE))));
ALTER POLICY "anchor_owner_delete" ON silver."lrunes_anchor" USING (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope));
ALTER POLICY "anchor_owner_insert" ON silver."lrunes_anchor" WITH CHECK (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lrunes'::text)),false) AS can_manage_scope));
ALTER POLICY "anchor_owner_delete" ON silver."lo3rwang_anchor" USING (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope));
ALTER POLICY "anchor_owner_insert" ON silver."lo3rwang_anchor" WITH CHECK (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope));
ALTER POLICY "anchor_owner_update" ON silver."lo3rwang_anchor" USING (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope)) WITH CHECK (( SELECT coalesce((SELECT allowed FROM silver.manage('scope','lo3rwang'::text)),false) AS can_manage_scope));
DROP FUNCTION silver.can_manage_scope(text) RESTRICT;
DROP FUNCTION silver.can_manage_group(text) RESTRICT;
DROP FUNCTION silver.can_manage_global() RESTRICT;
DROP FUNCTION silver.get_my_scope_management() RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;