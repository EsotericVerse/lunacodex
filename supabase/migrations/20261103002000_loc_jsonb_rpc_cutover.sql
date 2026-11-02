BEGIN;
CREATE OR REPLACE FUNCTION silver.loc_admin_settings(p_section text,p_operation text DEFAULT 'read',
 p_key text DEFAULT NULL,p_value jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','silver'
AS $loc$
DECLARE old_rows jsonb; new_rows jsonb:='[]'::jsonb; rec jsonb; exists_row boolean:=false;
 k text:=btrim(coalesce(p_key,'')); new_data jsonb;
BEGIN
 IF NOT silver.can_manage_global() THEN RAISE EXCEPTION 'Global administration required' USING ERRCODE='42501'; END IF;
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
END $loc$;
REVOKE ALL ON FUNCTION silver.loc_admin_settings(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silver.loc_admin_settings(text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION silver.is_current_email_blocklisted()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','silver','api'
AS $f$
 SELECT EXISTS(SELECT 1 FROM silver.loc l,
 jsonb_array_elements(COALESCE(l.blacklist->'email','[]'::jsonb)) entry
 WHERE l.id='loc' AND lower(entry.value->>'email')=silver.current_auth_email())
$f$;

CREATE OR REPLACE FUNCTION silver.manage_id_not_blocked()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
BEGIN
 IF EXISTS (SELECT 1 FROM silver.loc l,
 jsonb_array_elements(COALESCE(l.blacklist->'scopeid','[]'::jsonb)) entry
 WHERE l.id='loc' AND entry.value->>'id'=NEW.id) THEN
  RAISE EXCEPTION 'scope_id % is reserved',NEW.id;
 END IF;
 RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION silver.loc_public_routing_state()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $f$
 WITH prim AS (SELECT v.value target FROM silver.loc l,
   jsonb_array_elements(l.database) v WHERE l.id='loc' AND
   (v.value->>'selected')::boolean IS TRUE LIMIT 1),
 secondary AS (SELECT v.value target FROM silver.loc l,
   jsonb_array_elements(l.database) v WHERE l.id='loc' AND
   (v.value->>'backup_selected')::boolean IS TRUE LIMIT 1)
 SELECT jsonb_build_object(
   'provider',COALESCE((SELECT target->>'provider' FROM prim),'supabase'),
   'primary_id',COALESCE((SELECT target->>'target_id' FROM prim),'supabase-current'),
   'primary_control',COALESCE((SELECT target->>'provider'='supabase' AND
     target->>'connection_alias'='supabase_current' AND
     target->>'project_url'='https://qlouywsdiiyiyzpoxyqy.supabase.co' FROM prim),true),
   'backup_id',(SELECT target->>'target_id' FROM secondary),
   'backup_provider',(SELECT target->>'provider' FROM secondary),
   'mode',COALESCE((SELECT target->>'routing_mode' FROM prim),'single'))
$f$;
COMMIT;