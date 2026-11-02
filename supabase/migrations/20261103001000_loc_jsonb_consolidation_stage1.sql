BEGIN;
-- Stage 1: coexistence. Keep old tables and the legacy cache text[] until
-- the code deployment is verified; the final migration cuts them over.
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS database jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS blacklist jsonb NOT NULL
  DEFAULT '{"email":[],"scopeid":[]}'::jsonb;

UPDATE silver.loc SET
 database=COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.target_id)
                     FROM silver.loc_dblists d),'[]'::jsonb),
 blacklist=jsonb_build_object(
   'email',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.email)
                     FROM silver.email_blocklist e),'[]'::jsonb),
   'scopeid',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
                     FROM silver.block_scopeid b),'[]'::jsonb))
WHERE id='loc';

-- The LOC row is publicly readable, but its new database and blacklist data
-- must NOT be public. Revoking table-wide SELECT, keeping safe column reads.
REVOKE SELECT ON TABLE silver.loc FROM anon,authenticated;
GRANT SELECT(id,display_name,locale,"DefaultArticleClass",cache)
  ON silver.loc TO anon,authenticated;

CREATE OR REPLACE FUNCTION silver.loc_admin_settings(
  p_section text,p_operation text DEFAULT 'read',
  p_key text DEFAULT NULL,p_value jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','silver','api' AS $fn$
DECLARE
  current_value jsonb;
  result jsonb;
  item jsonb;
  updated jsonb := '[]'::jsonb;
  found_row boolean := false;
  key_value text := btrim(coalesce(p_key,''));
  entry jsonb;
BEGIN
  IF NOT silver.can_manage_global() THEN
    RAISE EXCEPTION 'Global administration required' USING ERRCODE='42501';
  END IF;
  IF p_section NOT IN ('database','email','scopeid') THEN
    RAISE EXCEPTION 'Unsupported LOC settings section';
  END IF;
  SELECT CASE WHEN p_section='database' THEN l.database
              ELSE l.blacklist->p_section END
    INTO current_value FROM silver.loc l WHERE id='loc' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOC settings not found'; END IF;
  current_value:=COALESCE(current_value,'[]'::jsonb);
  IF jsonb_typeof(current_value)<>'array' THEN
    RAISE EXCEPTION 'LOC settings array is invalid';
  END IF;
  IF p_operation='read' THEN RETURN current_value; END IF;
  IF p_section='database' THEN
    IF key_value !~ '^[A-Za-z][A-Za-z0-9_-]{0,80}$' THEN
      RAISE EXCEPTION 'Invalid database target ID';
    END IF;
    IF p_operation NOT IN ('upsert','delete') THEN
      RAISE EXCEPTION 'Unsupported database operation';
    END IF;
    IF p_operation='upsert' THEN
      IF jsonb_typeof(p_value)<>'object' OR
        coalesce(p_value->>'provider','') NOT IN ('supabase','neon','custom') OR
        coalesce(p_value->>'label','')='' OR
        coalesce(p_value->>'project_url','')='' THEN
        RAISE EXCEPTION 'Invalid database target metadata';
      END IF;
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(current_value) AS t(value)
    LOOP
      IF item->>'target_id'=key_value THEN
        found_row:=true;
        IF p_operation='delete' THEN
          IF COALESCE((item->>'selected')::boolean,false) OR
             COALESCE((item->>'backup_selected')::boolean,false) THEN
            RAISE EXCEPTION 'Active primary/backup target cannot be deleted';
          END IF;
        ELSE
          -- Old-selected/backup flags are immutable in the metadata editor.
          updated:=updated||jsonb_build_array(
            (p_value - 'selected' - 'backup_selected' - 'routing_mode' - 'target_id')
            ||jsonb_build_object('target_id',key_value,
                 'selected',COALESCE(item->'selected','false'::jsonb),
                 'backup_selected',COALESCE(item->'backup_selected','false'::jsonb),
                 'routing_mode',COALESCE(item->'routing_mode','"single"'::jsonb),
                 'updated_at',to_jsonb(now())));
        END IF;
      ELSE updated:=updated||jsonb_build_array(item); END IF;
    END LOOP;
    IF NOT found_row AND p_operation='upsert' THEN
      updated:=updated||jsonb_build_array(
        (p_value - 'target_id' - 'selected' - 'backup_selected' - 'routing_mode')
        ||jsonb_build_object('target_id',key_value,'selected',false,
           'backup_selected',false,'routing_mode','single','updated_at',now()));
    END IF;
    IF NOT found_row AND p_operation='delete' THEN RAISE EXCEPTION 'Target not found'; END IF;
    UPDATE silver.loc SET database=updated WHERE id='loc';
    RETURN updated;
  END IF;
  IF p_section='email' THEN
    key_value:=lower(key_value);
    IF key_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Invalid email';
    END IF;
    IF p_operation NOT IN ('add','remove') THEN RAISE EXCEPTION 'Invalid email operation'; END IF;
    IF p_operation='add' AND key_value=silver.current_auth_email() THEN
      RAISE EXCEPTION 'Cannot block the currently authenticated administrator';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(current_value) AS t(value) LOOP
      IF lower(item->>'email')=key_value THEN
        found_row:=true;
        IF p_operation='add' THEN updated:=updated||jsonb_build_array(item); END IF;
      ELSE updated:=updated||jsonb_build_array(item); END IF;
    END LOOP;
    IF p_operation='add' AND NOT found_row THEN
      updated:=updated||jsonb_build_array(jsonb_build_object('email',key_value,'created_at',now()));
    END IF;
  ELSE
    -- Scope routing reservations: only the note may be edited.
    IF p_operation<>'note' OR key_value='' THEN
      RAISE EXCEPTION 'Only reserved Scope notes may be updated';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(current_value) AS t(value) LOOP
      IF item->>'id'=key_value THEN
        found_row:=true;
        updated:=updated||jsonb_build_array(
          item||jsonb_build_object('note',nullif(btrim(coalesce(p_value#>>'{}','')),'')));
      ELSE updated:=updated||jsonb_build_array(item); END IF;
    END LOOP;
    IF NOT found_row THEN RAISE EXCEPTION 'Reserved Scope ID not found'; END IF;
  END IF;
  UPDATE silver.loc SET blacklist=jsonb_set(blacklist,ARRAY[p_section],updated,true)
  WHERE id='loc';
  RETURN updated;
END $fn$;
REVOKE ALL ON FUNCTION silver.loc_admin_settings(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silver.loc_admin_settings(text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION silver.is_current_email_blocklisted()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','silver','api' AS $fn$
  SELECT EXISTS(SELECT 1 FROM silver.loc l,
    jsonb_array_elements(COALESCE(l.blacklist->'email','[]'::jsonb)) e
    WHERE l.id='loc' AND lower(e.value->>'email')=silver.current_auth_email())
$fn$;

CREATE OR REPLACE FUNCTION silver.manage_id_not_blocked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM silver.loc l,
   jsonb_array_elements(COALESCE(l.blacklist->'scopeid','[]'::jsonb)) v
   WHERE l.id='loc' AND v.value->>'id'=NEW.id) THEN
   RAISE EXCEPTION 'scope_id % is reserved',NEW.id;
 END IF;
 RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION silver.loc_public_routing_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE result jsonb;
BEGIN
 WITH chosen AS (
   SELECT v.value target
   FROM silver.loc l, jsonb_array_elements(l.database) v
   WHERE l.id='loc' AND (v.value->>'selected')::boolean IS TRUE LIMIT 1
 ), secondary AS (
   SELECT v.value target
   FROM silver.loc l, jsonb_array_elements(l.database) v
   WHERE l.id='loc' AND (v.value->>'backup_selected')::boolean IS TRUE LIMIT 1
 )
 SELECT jsonb_build_object(
   'provider',COALESCE((SELECT target->>'provider' FROM chosen),'supabase'),
   'primary_id',COALESCE((SELECT target->>'target_id' FROM chosen),'supabase-current'),
   'primary_control',COALESCE((SELECT (target->>'provider'='supabase'
      AND target->>'connection_alias'='supabase_current')
      FROM chosen),true),
   'backup_id',(SELECT target->>'target_id' FROM secondary),
   'backup_provider',(SELECT target->>'provider' FROM secondary),
   'mode',COALESCE((SELECT target->>'routing_mode' FROM chosen),'single')
 ) INTO result;
 RETURN result;
END $fn$;
COMMIT;