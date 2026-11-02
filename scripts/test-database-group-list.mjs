import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Database targets live in private loc.database JSONB',()=>{
  const panel=read('app/loc/views/admin-panels/DatabaseTarget.jsx');
  const edge=read('supabase/functions/loc-kysely/index.ts');
  const rpc=read('supabase/migrations/20261103002000_loc_jsonb_rpc_cutover.sql');
  assert.match(panel,/rpc\('loc_admin_settings'/);
  assert.match(panel,/p_section:'database'/);
  assert.match(edge,/selectFrom\("silver.loc"\)\.select\("database"\)/);
  assert.match(edge,/updateTable\("silver.loc"\)/);
  assert.doesNotMatch(panel+edge,/_dblists|listRelation/);
  assert.match(rpc,/l\.database/);
});
test('Both blocklists use secured LOC RPC and JSONB',()=>{
  const mail=read('app/loc/views/admin-panels/AdminEmailBlocklist.jsx'),scopes=read('app/loc/views/admin-panels/AdminReservedScopeIds.jsx');
  const rpc=read('supabase/migrations/20261103002000_loc_jsonb_rpc_cutover.sql');
  assert.match(mail,/p_section:'email'/);
  assert.match(scopes,/p_section:'scopeid'/);
  assert.doesNotMatch(mail+scopes,/silver\.email_blocklist|silver\.block_scopeid/);
  assert.match(rpc,/CREATE OR REPLACE FUNCTION silver\.is_current_email_blocklisted/);
  assert.match(rpc,/CREATE OR REPLACE FUNCTION silver\.manage_id_not_blocked/);
});