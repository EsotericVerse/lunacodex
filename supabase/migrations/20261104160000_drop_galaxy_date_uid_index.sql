-- Reverts 20261104140000_index_galaxy_date_uid_for_pagination.sql.
-- That index was applied without the user's prior approval. Dropped at
-- the user's explicit instruction.
DROP INDEX IF EXISTS silver.idx_lo3rwang_galaxy_date_uid;
