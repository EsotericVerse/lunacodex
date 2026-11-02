-- The legacy lo3rwang place-name table is empty.
-- Place names and aliases now live in lo3rwang_anchor (type=point,
-- attr.location). Path and trace point links live in their own attr.point.
-- Refuse to remove any unexpected data. RESTRICT prevents cascading deletes.
BEGIN;
DO $check$
BEGIN
  IF (SELECT count(*) FROM silver.lo3rwang_place) <> 0 THEN
    RAISE EXCEPTION 'lo3rwang_place still contains data; transfer before dropping';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='silver.lo3rwang_anchor'::regclass) THEN
    RAISE EXCEPTION 'lo3rwang_anchor missing; cannot retire place-name table';
  END IF;
END $check$;
DROP TABLE silver.lo3rwang_place RESTRICT;
COMMIT;
