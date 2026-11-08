-- Seed ONLY the existing LOC-native database and registered physical Galaxy
-- tables. External delegated sources and mapping/auth settings are always
-- supplied by their owners; no external DBs or credentials are invented.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$
DECLARE
  native_uid text;
  table_uid text;
  current_uid text;
  item record;
  table_name text;
  tables jsonb;
BEGIN
  SELECT uid INTO native_uid FROM silver.loc_anchor
  WHERE type='database' AND title='LOC native primary' LIMIT 1;
  IF native_uid IS NULL THEN
    native_uid:=left(replace(gen_random_uuid()::text,'-',''),8);
    INSERT INTO silver.loc_anchor(uid,type,title,attr)
    VALUES(native_uid,'database','LOC native primary','{"uid":[]}'::jsonb);
  END IF;
  tables:=coalesce((SELECT attr->'uid' FROM silver.loc_anchor
    WHERE uid=native_uid),'[]'::jsonb);
  IF jsonb_typeof(tables)<>'array' THEN RAISE EXCEPTION 'Invalid LOC database mapping'; END IF;

  FOR item IN SELECT id FROM api.manage WHERE manage_role='scope' AND active=true LOOP
    IF item.id !~ '^[a-z][a-z0-9]{0,14}$' THEN
      RAISE EXCEPTION 'Invalid LOC native Scope';
    END IF;
    table_name:='silver.'||item.id||'_galaxy';
    IF to_regclass(table_name) IS NULL THEN
      RAISE EXCEPTION 'Missing native Galaxy table: %',table_name;
    END IF;
    SELECT uid INTO table_uid FROM silver.loc_anchor
      WHERE type='table' AND title=table_name LIMIT 1;
    IF table_uid IS NULL THEN
      table_uid:=left(replace(gen_random_uuid()::text,'-',''),8);
      INSERT INTO silver.loc_anchor(uid,type,title,attr)
      VALUES(table_uid,'table',table_name,jsonb_build_object(
        'database_uid',native_uid,
        'mapping',jsonb_build_object(
          'uid','uid','title','title','content','content','date','date',
          'createtime','createtime','site','site','place_id','place_id',
          'UpdateTime','UpdateTime'
        )));
    ELSE
      SELECT attr->>'database_uid' INTO current_uid
      FROM silver.loc_anchor WHERE uid=table_uid;
      IF current_uid<>native_uid THEN
        RAISE EXCEPTION 'Existing delegated table has a different database UID: %',table_name;
      END IF;
    END IF;
    IF NOT tables ? table_uid THEN tables:=tables||to_jsonb(table_uid); END IF;
  END LOOP;
  UPDATE silver.loc_anchor SET attr=jsonb_set(attr,'{uid}',tables)
  WHERE type='database' AND uid=native_uid;
END;
$$;
COMMIT;
