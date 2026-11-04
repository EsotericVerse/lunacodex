-- Scope-level switches are four physical booleans, NOT Galaxy.attr.
-- Preserve old scope.able numeric flags during the cutover.
-- Do not remove scope.able until remaining SQL/clients are audited.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='30s';
ALTER TABLE silver.lo3rwang ADD COLUMN IF NOT EXISTS trace boolean DEFAULT true;
ALTER TABLE silver.lo3rwang ADD COLUMN IF NOT EXISTS search boolean DEFAULT true;
ALTER TABLE silver.lo3rwang ADD COLUMN IF NOT EXISTS culture boolean DEFAULT true;
ALTER TABLE silver.lo3rwang ADD COLUMN IF NOT EXISTS statics boolean DEFAULT true;
ALTER TABLE silver.lrunes ADD COLUMN IF NOT EXISTS trace boolean DEFAULT true;
ALTER TABLE silver.lrunes ADD COLUMN IF NOT EXISTS search boolean DEFAULT true;
ALTER TABLE silver.lrunes ADD COLUMN IF NOT EXISTS culture boolean DEFAULT true;
ALTER TABLE silver.lrunes ADD COLUMN IF NOT EXISTS statics boolean DEFAULT true;
UPDATE silver.lo3rwang SET
 trace=COALESCE((able->>'trace')::integer=1,trace,true),
 search=COALESCE((able->>'search')::integer=1,search,true),
 culture=COALESCE((able->>'culture')::integer=1,culture,true),
 statics=COALESCE((able->>'statics')::integer=1,statics,true)
WHERE able IS NOT NULL AND jsonb_typeof(able)='object';
-- lrunes has no legacy scope.able field; retain its existing/default booleans.
COMMIT;
