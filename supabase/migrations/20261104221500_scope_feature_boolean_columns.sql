-- Stage Scope-level feature switches as native boolean columns.
-- Already applied to the live Supabase control DB; retained for replay/audit.
-- Drop silver.lo3rwang.able only after the new readers/writers are deployed.
ALTER TABLE silver.lo3rwang
  ADD COLUMN IF NOT EXISTS trace boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS search boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS culture boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS statics boolean NOT NULL DEFAULT true;
ALTER TABLE silver.lrunes
  ADD COLUMN IF NOT EXISTS trace boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS search boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS culture boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS statics boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='silver' AND table_name='lo3rwang' AND column_name='able'
  ) THEN
    UPDATE silver.lo3rwang SET
      trace=COALESCE((able->>'trace')::integer=1,true),
      search=COALESCE((able->>'search')::integer=1,true),
      culture=COALESCE((able->>'culture')::integer=1,true),
      statics=COALESCE((able->>'statics')::integer=1,true)
    WHERE able IS NOT NULL;
  END IF;
END $$;
