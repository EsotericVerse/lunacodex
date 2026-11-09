-- Extend ONLY existing Anchor CHECK constraints for the four source types.
-- No table/column/index/RPC changes; existing Keyword and Rune rules survive.
-- Every active Scope owns its own Domain/From nodes; Group upstream nodes
-- remain a LOC control-plane projection.
BEGIN;
DO $$
DECLARE
  r record;
  relation_name text;
  type_check text;
  attr_check text;
  attr_next text;
BEGIN
  FOR r IN
    SELECT id,coalesce(nullif(anchor_table,''),'anchor') AS anchor_suffix
    FROM api.manage WHERE manage_role='scope' AND active=true
  LOOP
    IF r.id !~ '^[a-z][a-z0-9]{0,14}$' OR
       r.anchor_suffix !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid registered Scope Anchor name';
    END IF;
    relation_name:=format('silver.%I',r.id||'_'||r.anchor_suffix);
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'Missing active Scope Anchor: %',relation_name;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO type_check
    FROM pg_constraint c
    WHERE c.conrelid=to_regclass(relation_name) AND c.conname='anchor_type_check';
    SELECT pg_get_constraintdef(c.oid) INTO attr_check
    FROM pg_constraint c
    WHERE c.conrelid=to_regclass(relation_name) AND c.conname='anchor_attr_keys_minimal_chk';
    IF type_check IS NULL OR attr_check IS NULL THEN
      RAISE EXCEPTION 'Anchor constraints must exist on %',relation_name;
    END IF;

    IF type_check NOT LIKE '%universe%' THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT anchor_type_check',relation_name);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT anchor_type_check CHECK (type IN (
          ''date'',''period'',''era'',''point'',''path'',''trace'',
          ''image'',''video'',''rune'',''suno'',
          ''category'',''class'',''group'',''item'',
          ''universe'',''galaxy'',''domain'',''from''))',relation_name);
    END IF;

    IF attr_check NOT LIKE '%universe%' THEN
      IF strpos(attr_check,'ELSE false')=0 THEN
        RAISE EXCEPTION 'Cannot safely extend unknown Anchor attr constraint on %',relation_name;
      END IF;
      attr_next:=replace(attr_check,'ELSE false',
        'WHEN (type = ANY (ARRAY[''universe''::text,''galaxy''::text,''domain''::text]))
          THEN ((attr ? ''uid'') AND jsonb_typeof(attr->''uid'') = ''array''
            AND ((attr - ''uid'') = ''{}''::jsonb))
         WHEN (type = ''from''::text) THEN (attr = ''{}''::jsonb)
         ELSE false');
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT anchor_attr_keys_minimal_chk',relation_name);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT anchor_attr_keys_minimal_chk %s',
        relation_name,attr_next);
    END IF;
  END LOOP;
END;
$$;
COMMIT;
