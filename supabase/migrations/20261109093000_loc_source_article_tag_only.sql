-- LOC ArticleTag-only classification. Retire source Anchors and blacklists.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE silver.loc
  DROP COLUMN IF EXISTS "DefaultArticleClass",
  DROP COLUMN IF EXISTS blacklist;
DELETE FROM silver.lo3rwang_anchor WHERE type IN ('universe','galaxy','domain','from');
DELETE FROM silver.lrunes_anchor WHERE type IN ('universe','galaxy','domain','from');
ALTER TABLE silver.lo3rwang_anchor DROP CONSTRAINT IF EXISTS anchor_type_check;
ALTER TABLE silver.lo3rwang_anchor ADD CONSTRAINT anchor_type_check
 CHECK (type IN ('date','period','era','point','path','trace','image','video','rune',
                'suno','category','class','group','item','pattern'));
ALTER TABLE silver.lrunes_anchor DROP CONSTRAINT IF EXISTS anchor_type_check;
ALTER TABLE silver.lrunes_anchor ADD CONSTRAINT anchor_type_check
 CHECK (type IN ('date','period','era','point','path','trace','image','video','rune',
                'suno','category','class','group','item','pattern'));
DROP TABLE IF EXISTS silver.loc_anchor;
COMMIT;
