-- Stage 1: non-breaking Group / System ownership split.
-- No RLS policies, grants, routing behavior or security roles are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- A Group owns an addressable Scope list: root LOC plus its child Scopes.
ALTER TABLE silver.loc DROP CONSTRAINT IF EXISTS loc_config_singleton;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS title_tw text;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS desc_tw text;
ALTER TABLE silver.loc ADD COLUMN IF NOT EXISTS birthday date;

-- These system settings belong to the manage control plane, not LOC Group.
ALTER TABLE silver.manage ADD COLUMN IF NOT EXISTS caches jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE silver.manage ADD COLUMN IF NOT EXISTS database jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE silver.manage ADD COLUMN IF NOT EXISTS note text;

-- Make the existing group row authoritative for its own title/description/date.
UPDATE silver.loc l SET
  title_tw=m.title_tw,desc_tw=m.desc_tw,birthday=m.birthday
FROM silver.manage m WHERE l.id=m.id AND m.id='loc';

-- Child IDs are the Scope List keys, not duplicate "scopeid" columns.
INSERT INTO silver.loc (id,display_name,locale,title_tw,desc_tw,birthday)
SELECT m.id,m.display_name,'zh-Hant',m.title_tw,m.desc_tw,m.birthday
FROM silver.manage m
WHERE m.manage_role='scope' AND m.parent_scope_id='loc'
  AND m.id IN ('lo3rwang','lrunes')
ON CONFLICT (id) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  title_tw=EXCLUDED.title_tw,
  desc_tw=EXCLUDED.desc_tw,
  birthday=EXCLUDED.birthday;

-- Copy the two system-owned JSONB payloads. No deletion in this stage.
UPDATE silver.manage m SET
  caches=l.caches,database=l.database
FROM silver.loc l WHERE m.id='admin' AND l.id='loc';

DO $verify$
BEGIN
  IF (SELECT count(*) FROM silver.loc WHERE id IN ('loc','lo3rwang','lrunes'))<>3
  THEN RAISE EXCEPTION 'LOC Scope List cutover has missing rows'; END IF;
  IF EXISTS (
    SELECT 1 FROM silver.manage m JOIN silver.loc l ON l.id=m.id
    WHERE m.id IN ('loc','lo3rwang','lrunes')
      AND (m.birthday IS DISTINCT FROM l.birthday
        OR m.title_tw IS DISTINCT FROM l.title_tw
        OR m.desc_tw IS DISTINCT FROM l.desc_tw)
  ) THEN RAISE EXCEPTION 'Scope metadata copy mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM silver.manage m JOIN silver.loc l ON l.id='loc'
    WHERE m.id='admin'
      AND (m.caches IS DISTINCT FROM l.caches OR m.database IS DISTINCT FROM l.database)
  ) THEN RAISE EXCEPTION 'System settings copy mismatch'; END IF;
END $verify$;
COMMIT;
