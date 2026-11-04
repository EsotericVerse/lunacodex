-- Align the still-installed legacy API provisioning RPC with native
-- Scope-level Boolean flags, without recreating retired *_able columns.
-- The Kysely provisioning action already writes search/statics/culture/trace.
-- The API RPC remains callable in older routes and must not break.
DO $patch$
DECLARE
  fn_oid oid;
  ddl text;
  old_columns constant text := 'search_able,' || chr(10) || '       statistics_able,culture_able';
  new_columns constant text := 'search,' || chr(10) || '       statics,culture,trace';
  old_values constant text := 'true,true,true,32,100';
  new_values constant text := 'true,true,true,true,32,100';
BEGIN
  fn_oid := to_regprocedure('api.provision_scope(text,text,text,date,text,text,text,text,boolean)');
  IF fn_oid IS NULL THEN
    RAISE NOTICE 'api.provision_scope not installed: Kysely entry is authoritative';
    RETURN;
  END IF;
  ddl := pg_get_functiondef(fn_oid);
  IF position(old_columns IN ddl)=0 THEN
    IF position(new_columns IN ddl)>0 THEN
      RAISE NOTICE 'api.provision_scope Boolean columns already migrated';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Unexpected api.provision_scope body; manual review required';
  END IF;
  IF position(old_values IN ddl)=0 THEN
    RAISE EXCEPTION 'Unexpected api.provision_scope INSERT values';
  END IF;
  ddl := replace(replace(ddl,old_columns,new_columns),old_values,new_values);
  EXECUTE ddl;
END
$patch$;
