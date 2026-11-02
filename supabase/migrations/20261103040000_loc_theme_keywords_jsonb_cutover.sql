-- Copy first. Keep both old relations readable until the deployed code stops using them.
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE silver.loc l
SET theme=COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.theme_order)
                    FROM silver.loc_theme t),'[]'::jsonb),
 keywords=COALESCE((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.scope_id,k.class_name)
                    FROM silver.loc_keywords k),'[]'::jsonb)
WHERE l.id='loc';
GRANT SELECT(theme) ON silver.loc TO anon,authenticated;
DO $check$
BEGIN
 IF (SELECT jsonb_array_length(theme) FROM silver.loc WHERE id='loc')<>(SELECT count(*) FROM silver.loc_theme)
 OR (SELECT jsonb_array_length(keywords) FROM silver.loc WHERE id='loc')<>(SELECT count(*) FROM silver.loc_keywords)
 THEN RAISE EXCEPTION 'LOC catalog copy row-count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM silver.loc_theme t WHERE NOT EXISTS
   (SELECT 1 FROM silver.loc l,jsonb_array_elements(l.theme) v WHERE l.id='loc' AND v=to_jsonb(t)))
 OR EXISTS(SELECT 1 FROM silver.loc_keywords k WHERE NOT EXISTS
   (SELECT 1 FROM silver.loc l,jsonb_array_elements(l.keywords) v WHERE l.id='loc' AND v=to_jsonb(k)))
 THEN RAISE EXCEPTION 'LOC catalog copy content mismatch'; END IF;
END $check$;

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
 IF NOT silver.can_manage_global() THEN
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
END $function$;

CREATE OR REPLACE FUNCTION silver.read_app_bootstrap(p_scope_id text DEFAULT ''::text, p_page_name text DEFAULT 'index'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id text := lower(btrim(coalesce(p_scope_id, '')));
  v_page text := lower(btrim(coalesce(p_page_name, 'index')));
  v_config jsonb; v_blocks jsonb; v_table regclass; v_registry jsonb := '[]'::jsonb;
  v_name_sql text; v_names jsonb := '{}'::jsonb;
  v_theme_rows jsonb := '[]'::jsonb;
  v_loc_rows jsonb := '[]'::jsonb;
  v_page_copy jsonb := '[]'::jsonb;
  r record; r2 record;
begin
  if v_id !~ '^[a-z][a-z0-9]{0,14}$' then v_id := ''; end if;
  if v_page !~ '^[a-z0-9_-]+$' then v_page := 'index'; end if;

  -- One authoritative Scope metadata snapshot for this RPC execution.
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]'::jsonb)
  into v_loc_rows from silver.manage l;

  if v_id <> '' then
    v_table := to_regclass(format('silver.%I', v_id));
    if v_table is not null then
      if v_table = 'silver.loc'::regclass then
        select to_jsonb(t) - 'id' into v_config from silver.loc t where t.id=v_id;
      else
        execute format($q$select to_jsonb(t) - 'id' from %1$s t where t.id = $1$q$, v_table) into v_config using v_id;
      end if;
    end if;
    v_table := to_regclass(format('silver.%I', v_id || '_blocks'));
    if v_table is not null then
      execute format($q$
        select coalesce(jsonb_agg(to_jsonb(b) order by b.block_order), '[]'::jsonb)
        from (select uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image
              from %1$s where page_name = $1) b
      $q$, v_table) into v_blocks using v_page;
    end if;
  end if;

  -- 修正1：N 次動態查詢 -> 1 次 UNION ALL 動態查詢，結果收進 id->display_name 的 map。
  select string_agg(
    format('select %L::text as id, display_name from silver.%I where id = %L',
      obj->>'id',obj->>'id',obj->>'id'), ' union all '
  ) into v_name_sql
  from jsonb_array_elements(v_loc_rows) as loc(obj)
  where (obj->>'active')::boolean
    and to_regclass(format('silver.%I',obj->>'id')) is not null;

  if v_name_sql is not null then
    for r2 in execute v_name_sql loop
      v_names := v_names || jsonb_build_object(r2.id, r2.display_name);
    end loop;
  end if;

  for r in
    select obj->>'id' as id, obj->>'manage_role' as role,
           obj->>'domain' as domain, obj->>'directory' as directory,
           obj->>'parent_scope_id' as parent_scope_id,
           (obj->>'active')::boolean as active,
           (obj->>'sort_order')::integer as sort_order
    from jsonb_array_elements(v_loc_rows) as loc(obj)
    where (obj->>'active')::boolean
    order by sort_order,id
  loop
    v_registry := v_registry || jsonb_build_array(jsonb_build_object(
      'scope_id', r.id, 'display_name', coalesce(v_names->>r.id, r.id),
      'scope_kind', case when r.role='group' then 'group' else 'scope' end,
      'domain', r.domain, 'directory', r.directory,
      'parent_scope_id', r.parent_scope_id, 'active', r.active, 'sort_order', r.sort_order));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'scope_id',obj->>'id','Title_TW',obj->>'title_tw','Desc_TW',obj->>'desc_tw'
    )),'[]'::jsonb) into v_page_copy
  from jsonb_array_elements(v_loc_rows) as loc(obj)
  where obj->>'manage_role' in ('admin','scope')
    and (obj->>'active')::boolean;

  -- One JSONB catalog read, preserving both legacy response shapes.
  select l.theme into v_theme_rows from silver.loc l where l.id='loc';

  return jsonb_build_object(
    'scope_id', v_id, 'page_name', v_page, 'config', v_config, 'blocks', coalesce(v_blocks, '[]'::jsonb),
    'registry', v_registry,
    'page_copy', v_page_copy,
    'theme_list', coalesce((select jsonb_agg(jsonb_build_object('theme_id', x.value->'theme_id', 'theme_name', x.value->'theme_name', 'theme_order', x.value->'theme_order') ORDER BY (x.value->>'theme_order')::int) FROM jsonb_array_elements(v_theme_rows) x(value)), '[]'::jsonb),
    'themes', coalesce(v_theme_rows, '[]'::jsonb)
  );
end;
$function$;

REVOKE ALL ON FUNCTION silver.loc_catalog(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silver.loc_catalog(text,text,text,jsonb) TO authenticated;
