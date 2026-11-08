-- LOC delegated-source registry + Scope-owned Pattern postings.
-- A database/table mapping is LOC metadata; the source content stays remote.
-- Pattern attr is { "<db_uid>": ["<article_uid>", ...] }. No source copies.
-- The existing loc_search_pattern remains until every read/write caller migrates.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE TABLE IF NOT EXISTS silver.loc_anchor (
  uid varchar(8) PRIMARY KEY,
  type text NOT NULL,
  title text,
  description text,
  invisible boolean NOT NULL DEFAULT false,
  attr jsonb NOT NULL DEFAULT '{}'::jsonb,
  createtime timestamptz DEFAULT CURRENT_TIMESTAMP,
  num bigint NOT NULL DEFAULT 0,
  CONSTRAINT loc_anchor_uid_eight_chk CHECK (uid ~ '^[A-Za-z0-9]{8}$'),
  CONSTRAINT loc_anchor_type_check CHECK (type IN ('database','table')),
  CONSTRAINT loc_anchor_attr_object_chk CHECK (jsonb_typeof(attr)='object'),
  CONSTRAINT loc_anchor_num_nonnegative_chk CHECK (num>=0),
  CONSTRAINT loc_anchor_mapping_shape_chk CHECK (
    CASE
      WHEN type='database' THEN
        (NOT (attr ? 'uid') OR jsonb_typeof(attr->'uid')='array')
      WHEN type='table' THEN
        (attr ? 'database_uid')
        AND jsonb_typeof(attr->'database_uid')='string'
        AND (attr->>'database_uid') ~ '^[A-Za-z0-9]{8}$'
        AND (NOT (attr ? 'mapping') OR jsonb_typeof(attr->'mapping')='object')
      ELSE false
    END
  )
);
COMMENT ON TABLE silver.loc_anchor IS
  'LOC-owned database/table mapping metadata. Never store external article bodies or authentication secrets.';
COMMENT ON COLUMN silver.loc_anchor.attr IS
  'Database: optional uid[] of table mapping nodes and auth reference (not credentials). Table: database_uid and client-supplied semantic field mapping.';
COMMENT ON COLUMN silver.loc_anchor.num IS
  'Reserved nonnegative derived count; not the number of mapping child UIDs.';
-- The mapping registry may include private structural metadata: no browser
-- direct Data API access. The trusted LOC Auth/Kysely backend owns access.
REVOKE ALL ON silver.loc_anchor FROM PUBLIC, anon, authenticated;

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
  'Legacy empty Scope keyword index; retained only while readers/writers move to Scope Anchor type=pattern. Do not treat as the LOC database/table mapping registry.';
COMMIT;
