-- One-time LOC-only cutover: silver.loc_blocks -> silver.loc_anchor.
-- The existing source Anchor hierarchy (from/domain/galaxy/universe) is unchanged.
-- Keep this script as the auditable schema/data migration; run before app cutover.
BEGIN;

ALTER TABLE silver.loc_anchor DROP CONSTRAINT loc_anchor_type_chk;
ALTER TABLE silver.loc_anchor ADD CONSTRAINT loc_anchor_type_chk CHECK (
  type IN ('from','domain','galaxy','universe')
  OR (
    type ~ '^[A-Za-z][A-Za-z0-9_-]{0,60}$'
    AND type NOT IN ('from','domain','galaxy','universe')
  )
);

ALTER TABLE silver.loc_anchor DROP CONSTRAINT loc_anchor_attr_object_chk;
ALTER TABLE silver.loc_anchor ADD CONSTRAINT loc_anchor_attr_object_chk CHECK (
  jsonb_typeof(attr)='object' AND (
    (type IN ('from','domain','galaxy','universe')
     AND jsonb_typeof(attr->'uid')='array'
     AND jsonb_typeof(attr->'counts')='object'
     AND jsonb_typeof(attr#>'{counts,lo3rwang}')='number'
     AND jsonb_typeof(attr#>'{counts,lrunes}')='number')
    OR
    (type NOT IN ('from','domain','galaxy','universe')
     AND coalesce(jsonb_typeof(attr->'uidlist')='array',false)
     AND coalesce(jsonb_typeof(attr->'eyebrow')='string',false)
     AND coalesce(jsonb_typeof(attr->'subtitle')='string',false)
     AND coalesce(jsonb_typeof(attr->'image') IN ('null','string'),false))
  )
);

-- Preserve every UID, title, text, image payload, entity list and order.
-- The old Blocks relation has no createtime column, so Anchor uses NOW().
INSERT INTO silver.loc_anchor
  (uid,type,title,description,invisible,attr,createtime,num)
SELECT
  uid,page_name,block_title,block_text,false,
  jsonb_build_object(
    'uidlist',block_entity,
    'eyebrow',block_eyebrow,
    'subtitle',block_subtitle,
    'image',block_image
  ),
  CURRENT_TIMESTAMP,block_order
FROM silver.loc_blocks;

DO $$
DECLARE mismatched integer;
BEGIN
  SELECT count(*) INTO mismatched
  FROM silver.loc_blocks b
  LEFT JOIN silver.loc_anchor a ON a.uid=b.uid
  WHERE a.uid IS NULL
    OR a.type IS DISTINCT FROM b.page_name
    OR a.title IS DISTINCT FROM b.block_title
    OR a.description IS DISTINCT FROM b.block_text
    OR a.num IS DISTINCT FROM b.block_order
    OR a.invisible IS DISTINCT FROM false
    OR a.attr IS DISTINCT FROM jsonb_build_object(
      'uidlist',b.block_entity,'eyebrow',b.block_eyebrow,
      'subtitle',b.block_subtitle,'image',b.block_image
    );
  IF mismatched<>0 THEN
    RAISE EXCEPTION 'LOC Block Anchor copy verification failed: % rows',mismatched;
  END IF;
END $$;

COMMIT;
-- The old physical table is retired only after the new application is live
-- and the 34 copied rows have been verified. Never drop during this copy step.
