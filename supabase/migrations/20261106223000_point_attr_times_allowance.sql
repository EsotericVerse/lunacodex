-- Point visit instants are a property of a spatial identity. The same place_id
-- may collect articles with different location spellings or merged Point UIDs.
-- All times are source-derived ISO-8601 UTC strings; createtime remains a
-- separate physical timestamp. Only the Point attr key set is extended.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE silver.lo3rwang_anchor
  DROP CONSTRAINT anchor_attr_keys_minimal_chk;
ALTER TABLE silver.lo3rwang_anchor
  ADD CONSTRAINT anchor_attr_keys_minimal_chk CHECK (
  CASE
    WHEN type='date' THEN attr ? 'date' AND attr - 'date'='{}'::jsonb
    WHEN type='period' THEN attr ? 'uid' AND attr - 'uid' - 'date'='{}'::jsonb
    WHEN type='era' THEN attr ? 'period' AND attr - 'period' - 'date'='{}'::jsonb
    WHEN type='point' THEN
      attr - 'longitude' - 'latitude' - 'location' - 'times'='{}'::jsonb
      AND (NOT (attr ? 'times') OR jsonb_typeof(attr->'times')='array')
    WHEN type='path' THEN attr - 'point'='{}'::jsonb
    WHEN type='trace' THEN attr - 'point' - 'path'='{}'::jsonb
    WHEN type IN ('category','class') THEN attr ? 'uid' AND attr - 'uid'='{}'::jsonb
    WHEN type='group' THEN attr ? 'uid' AND attr - 'uid' - 'total'='{}'::jsonb
    WHEN type='item' THEN attr ? 'keyword' AND attr - 'keyword' - 'total'='{}'::jsonb
    WHEN type IN ('image','video','rune','suno') THEN
      attr - 'url' - 'date'='{}'::jsonb
    ELSE false
  END
);

ALTER TABLE silver.lrunes_anchor
  DROP CONSTRAINT anchor_attr_keys_minimal_chk;
ALTER TABLE silver.lrunes_anchor
  ADD CONSTRAINT anchor_attr_keys_minimal_chk CHECK (
  CASE
    WHEN type='date' THEN attr ? 'date' AND attr - 'date'='{}'::jsonb
    WHEN type='period' THEN attr ? 'uid' AND attr - 'uid' - 'date'='{}'::jsonb
    WHEN type='era' THEN attr ? 'period' AND attr - 'period' - 'date'='{}'::jsonb
    WHEN type='point' THEN
      attr - 'longitude' - 'latitude' - 'location' - 'times'='{}'::jsonb
      AND (NOT (attr ? 'times') OR jsonb_typeof(attr->'times')='array')
    WHEN type='path' THEN attr - 'point'='{}'::jsonb
    WHEN type='trace' THEN attr - 'point' - 'path'='{}'::jsonb
    WHEN type IN ('category','class') THEN attr ? 'uid' AND attr - 'uid'='{}'::jsonb
    WHEN type='group' THEN attr ? 'uid' AND attr - 'uid' - 'total'='{}'::jsonb
    WHEN type='item' THEN attr ? 'keyword' AND attr - 'keyword' - 'total'='{}'::jsonb
    WHEN type='rune' THEN attr - 'url' - 'date' - 'rune'='{}'::jsonb
      AND (NOT (attr ? 'rune') OR jsonb_typeof(attr->'rune') IN ('object','array'))
    WHEN type IN ('image','video','suno') THEN
      attr - 'url' - 'date'='{}'::jsonb
    ELSE false
  END
);
COMMIT;
