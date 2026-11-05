-- Retire the two legacy PostgreSQL Blocks move RPCs.
-- Current block reorder uses the Kysely managed action "move_scope_block".
-- Do not remove that action: the Blocks editor still uses it.
-- RESTRICT is intentional: fail if new schema dependencies are introduced.
BEGIN;
DROP FUNCTION IF EXISTS silver.move_scope_block(text,text,text,integer) RESTRICT;
DROP FUNCTION IF EXISTS api.move_scope_block(text,text,text,integer) RESTRICT;
COMMIT;
