-- Scope Pattern support on existing registered Anchor tables.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Respect each registered Scope's existing physical Anchor name and original
-- CHECK expressions (including lrunes rune extensions). Add only new cases.
DO $$
DECLARE
  entry record;
  relation_name text;
  type_check text;
  attr_check text;
  type_expr text;
  attr_expr text;
BEGIN
  FOR entry IN
    SELECT id,coalesce(nullif(anchor_table,''),'anchor') AS anchor_suffix
    FROM api.manage WHERE manage_role='scope' AND active=true
  LOOP
    IF entry.id !~ '^[a-z][a-z0-9]{0,14}$'
       OR entry.anchor_suffix !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid registered Scope Anchor mapping';
    END IF;
    relation_name:=format('silver.%I',entry.id||'_'||entry.anchor_suffix);
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'Missing registered Scope Anchor: %',relation_name;
    END IF;

    EXECUTE format(
      'ALTER TABLE %s ADD COLUMN IF NOT EXISTS num bigint NOT NULL DEFAULT 0',
      relation_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(relation_name)
        AND conname='anchor_num_nonnegative_chk'
    ) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT anchor_num_nonnegative_chk CHECK (num>=0)',
        relation_name);
    END IF;

    SELECT pg_get_constraintdef(oid) INTO type_check
      FROM pg_constraint
      WHERE conrelid=to_regclass(relation_name) AND conname='anchor_type_check';
    SELECT pg_get_constraintdef(oid) INTO attr_check
      FROM pg_constraint
      WHERE conrelid=to_regclass(relation_name)
        AND conname='anchor_attr_keys_minimal_chk';
    IF type_check IS NULL OR attr_check IS NULL
       OR left(type_check,7)<>'CHECK (' OR left(attr_check,7)<>'CHECK (' THEN
      RAISE EXCEPTION 'Unrecognized Anchor constraints: %',relation_name;
    END IF;

    IF strpos(type_check,'''pattern''')=0 THEN
      type_expr:=substr(type_check,8,length(type_check)-8);
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT anchor_type_check, ADD CONSTRAINT anchor_type_check CHECK ((%s) OR (type=''pattern''))',
        relation_name,type_expr);
    END IF;
    IF strpos(attr_check,'type = ''pattern''')=0 THEN
      attr_expr:=substr(attr_check,8,length(attr_check)-8);
      -- Legacy Item keyword[] stays valid; new Items link Pattern UIDs
      -- through attr.uid. Old values are not rewritten by this migration.
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT anchor_attr_keys_minimal_chk, ADD CONSTRAINT anchor_attr_keys_minimal_chk CHECK ((%s) OR (type=''item'' AND attr ? ''uid'' AND jsonb_typeof(attr->''uid'')=''array'' AND attr - ''uid'' - ''keyword'' - ''total'' = ''{}''::jsonb) OR (type=''pattern'' AND jsonb_typeof(attr)=''object''))',
        relation_name,attr_expr);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON TABLE silver.loc_search_pattern IS
  'Legacy empty Scope keyword index; retained while readers/writers move to Scope Anchor type=pattern.';
COMMIT;
