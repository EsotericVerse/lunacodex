-- Fix off-by-one bug in *_entity_check: block_entity stores [bubbleColumnCount, ...up to 6 entities],
-- so a fully-populated block (6 entities) is a 7-element array, not <=6. Raise the cap to 7.
-- Root cause: app/loc/home-block-model.js serializeHomeBubbleEntities() prepends a column-count slot.
-- Symptom fixed: "LOC native database operation unavailable" on home-block save, 100% reproducible
-- whenever a block held its maximum 6 entities.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE silver.lo3rwang_blocks DROP CONSTRAINT lo3rwang_blocks_entity_check;
ALTER TABLE silver.lo3rwang_blocks ADD CONSTRAINT lo3rwang_blocks_entity_check
  CHECK (jsonb_typeof(block_entity)='array' AND jsonb_array_length(block_entity) <= 7);
ALTER TABLE silver.loc_blocks DROP CONSTRAINT loc_blocks_entity_check;
ALTER TABLE silver.loc_blocks ADD CONSTRAINT loc_blocks_entity_check
  CHECK (jsonb_typeof(block_entity)='array' AND jsonb_array_length(block_entity) <= 7);
ALTER TABLE silver.lrunes_blocks DROP CONSTRAINT lrunes_blocks_entity_check;
ALTER TABLE silver.lrunes_blocks ADD CONSTRAINT lrunes_blocks_entity_check
  CHECK (jsonb_typeof(block_entity)='array' AND jsonb_array_length(block_entity) <= 7);
COMMIT;
