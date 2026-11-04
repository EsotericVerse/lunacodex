-- User-requested bounded diagnostic counter. Preserve existing observations.
-- Do NOT instrument silver.manage() with SQL writes: it is part of RLS hot paths.
-- This migration introduces no query, timer, trigger, index, or permission grant.
ALTER TABLE silver.lo3rwang
  ADD COLUMN IF NOT EXISTS "count" integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='silver.lo3rwang'::regclass
      AND conname='lo3rwang_permission_count_cap'
  ) THEN
    ALTER TABLE silver.lo3rwang
      ADD CONSTRAINT lo3rwang_permission_count_cap
      CHECK ("count" BETWEEN 0 AND 1000);
  END IF;
END $$;

COMMENT ON COLUMN silver.lo3rwang."count" IS
  'Bounded diagnostic observation (0-1000), not a live authorization gate. Do not write from RLS-backed silver.manage().';
