-- Anchor creation/provenance timestamp, independent of cultural attr.date.
-- UID stays the PK. createtime is deliberately NOT UNIQUE: multiple images may
-- belong to one article and share that article's timestamp.
-- Old rows remain NULL unless their source article time is unambiguous.
ALTER TABLE silver.lo3rwang_anchor
  ADD COLUMN IF NOT EXISTS createtime timestamptz;
ALTER TABLE silver.lrunes_anchor
  ADD COLUMN IF NOT EXISTS createtime timestamptz;

-- Future manually created Anchors get their own creation instant. Importers
-- explicitly pass the original article createtime (not the import instant).
ALTER TABLE silver.lo3rwang_anchor
  ALTER COLUMN createtime SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE silver.lrunes_anchor
  ALTER COLUMN createtime SET DEFAULT CURRENT_TIMESTAMP;

-- Restore only media timestamps proved by existing Galaxy.media_link links.
-- A media UID reused by articles with different timestamps has no single
-- demonstrable historical source time: leave it NULL for review, never guess.
WITH source AS (
  SELECT a.uid, min(g.createtime) AS article_createtime
  FROM silver.lo3rwang_anchor a
  JOIN silver.lo3rwang_galaxy g ON a.uid=ANY(g.media_link)
  WHERE a.type IN ('image','video','suno','rune') AND g.createtime IS NOT NULL
  GROUP BY a.uid
  HAVING count(DISTINCT g.createtime)=1
)
UPDATE silver.lo3rwang_anchor a SET createtime=s.article_createtime
FROM source s WHERE a.uid=s.uid AND a.createtime IS NULL;

WITH source AS (
  SELECT a.uid, min(g.createtime) AS article_createtime
  FROM silver.lrunes_anchor a
  JOIN silver.lrunes_galaxy g ON a.uid=ANY(g.media_link)
  WHERE a.type IN ('image','video','suno','rune') AND g.createtime IS NOT NULL
  GROUP BY a.uid
  HAVING count(DISTINCT g.createtime)=1
)
UPDATE silver.lrunes_anchor a SET createtime=s.article_createtime
FROM source s WHERE a.uid=s.uid AND a.createtime IS NULL;

COMMENT ON COLUMN silver.lo3rwang_anchor.createtime IS
  'Anchor creation/source article instant; unrelated to cultural attr.date. For media, NULL means no unambiguous original article time.';
COMMENT ON COLUMN silver.lrunes_anchor.createtime IS
  'Anchor creation/source article instant; unrelated to cultural attr.date. For media, NULL means no unambiguous original article time.';
