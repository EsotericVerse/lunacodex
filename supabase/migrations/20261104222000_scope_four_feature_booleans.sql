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
-- Some deployments already dropped Scope.able; conditionally migrate only
-- databases still holding it. No reinstatement of the obsolete column.
DO $scope$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='silver' AND table_name='lo3rwang' AND column_name='able'
  ) THEN
    EXECUTE $statement$UPDATE silver.lo3rwang SET
      trace=COALESCE((able->>'trace')::integer=1,trace,true),
      search=COALESCE((able->>'search')::integer=1,search,true),
      culture=COALESCE((able->>'culture')::integer=1,culture,true),
      statics=COALESCE((able->>'statics')::integer=1,statics,true)
      WHERE able IS NOT NULL AND jsonb_typeof(able)='object'$statement$;
  END IF;
END;
$scope$;
-- The four physical booleans are now canonical; never retain an old
-- Scope-level numeric flag envelope after verified values are copied.
ALTER TABLE silver.lo3rwang DROP COLUMN IF EXISTS able RESTRICT;
-- lrunes has no legacy scope.able field; retain its existing/default booleans.
COMMIT;
