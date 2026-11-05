-- Retire ONLY the silver.manage.database configuration column.
-- Supabase and Neon projects, connections, Vault and data are untouched.
-- No RLS, grants, policies or other schema changes.
-- Apply after the new Gateway + Admin bundle are in production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM silver.manage m
      CROSS JOIN LATERAL jsonb_array_elements(m.database) value
      WHERE m.id='admin')<>2
  THEN RAISE EXCEPTION 'Expected exactly two database target records'; END IF;
END $preflight$;
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
 IF p_section NOT IN ('email','scopeid') THEN RAISE EXCEPTION 'Unknown settings section'; END IF;
 IF p_section='scopeid' THEN
   -- IDs with role reserve live in the system Routing registry. The
   -- existing admin ID is intrinsically reserved and retains its role.
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'note',m.note)
            ORDER BY m.id),'[]'::jsonb) INTO old_rows
   FROM silver.manage m WHERE m.manage_role='reserve' OR m.id='admin';
   IF p_operation='read' THEN RETURN old_rows; END IF;
   IF p_operation<>'note' OR k='' THEN RAISE EXCEPTION 'Only reserved Scope notes may be edited'; END IF;
   UPDATE silver.manage SET note=nullif(btrim(coalesce(p_value#>>'{}','')),'')
   WHERE id=k AND (manage_role='reserve' OR id='admin');
   IF NOT FOUND THEN RAISE EXCEPTION 'Unknown reserved Scope ID'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'note',m.note)
            ORDER BY m.id),'[]'::jsonb) INTO old_rows
   FROM silver.manage m WHERE m.manage_role='reserve' OR m.id='admin';
   RETURN old_rows;
 END IF;
 SELECT blacklist->'email' INTO old_rows
 FROM silver.loc WHERE id='loc' FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(old_rows)<>'array'
 THEN RAISE EXCEPTION 'LOC Email List is missing'; END IF;
 IF p_operation='read' THEN RETURN old_rows; END IF;
 k:=lower(k);
 IF k !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   OR p_operation NOT IN ('add','remove')
 THEN RAISE EXCEPTION 'Invalid email action'; END IF;
 IF p_operation='add' AND k=silver.current_auth_email()
 THEN RAISE EXCEPTION 'Current administrator cannot be blocked'; END IF;
 FOR rec IN SELECT value FROM jsonb_array_elements(old_rows) LOOP
   IF lower(rec->>'email')=k THEN
     exists_row:=true;
     IF p_operation='add' THEN new_rows:=new_rows||jsonb_build_array(rec); END IF;
   ELSE new_rows:=new_rows||jsonb_build_array(rec); END IF;
 END LOOP;
 IF p_operation='add' AND NOT exists_row THEN
   new_rows:=new_rows||jsonb_build_array(jsonb_build_object('email',k,'created_at',now()));
 END IF;
 UPDATE silver.loc SET blacklist=jsonb_set(blacklist,'{email}',new_rows,true) WHERE id='loc';
 RETURN new_rows;
END $function$;
ALTER TABLE silver.manage DROP COLUMN IF EXISTS database;
DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='silver' AND table_name='manage' AND column_name='database')
  THEN RAISE EXCEPTION 'manage.database still exists'; END IF;
END $verify$;
COMMIT;
