import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {checkDbContract,checkLocScopeBoundary} from './check-db-contract.mjs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const contract=read('app/loc/db-contract.mjs');
const client=read('app/loc/db-client.mjs');
test('DB contract checks all returned values and consumer bindings',()=>{
  const result=checkDbContract(contract,client);
  assert.ok(result.exported>=25);
  assert.ok(result.consumed>=25);
});
test('missing implementation fails before a cloud production build',()=>{
  const without=contract.replace(/\s*async function readKeywordUidlistSummary\([^]*?\n  \}\n\s*\/\/ Rune66 stored classification/,
    '\n  // Rune66 stored classification');
  assert.notEqual(without,contract);
  assert.throws(()=>checkDbContract(without,client),/undeclared bindings: readKeywordUidlistSummary/);
});
test('consumer typo is detected instead of silently becoming undefined',()=>{
  const broken=client.replace('readKeywordUidlistSummary,','readKeywordUidlissSummary,');
  assert.notEqual(broken,client);
  assert.throws(()=>checkDbContract(contract,broken),/missing contract exports: readKeywordUidlissSummary/);
});

test('new Postgres keyword RPC grants only to roles present in the installation',()=>{
  const sql=read('supabase/migrations/20261029223000_keyword_uidlist_readers.sql');
  assert.match(sql,/REVOKE ALL ON FUNCTION silver\.read_keyword_uidlist_summary\(text,date,date,text\) FROM PUBLIC/);
  assert.match(sql,/rolname='anon'/);
  assert.match(sql,/rolname='anonymous'/);
  assert.match(sql,/rolname='authenticated'/);
  assert.doesNotMatch(sql,/TO anon,authenticated;/);
  assert.doesNotMatch(sql,/CREATE ROLE|CREATE USER/i);
});

test('LOC cannot be used as a Scope data landing zone in new migrations',()=>{
  assert.deepEqual(checkLocScopeBoundary([['safe.sql','SELECT id FROM silver.loc WHERE id=\'loc\';']]),{checked:1});
  for(const sql of [
    'INSERT INTO silver.loc(id,keyword_meta) SELECT id,to_jsonb(t) FROM silver.lo3rwang_blocks t;',
    'ALTER TABLE silver.loc DROP CONSTRAINT loc_config_singleton;',
    'ALTER TABLE silver.loc ADD COLUMN search_able boolean;',
    'DELETE FROM silver.loc WHERE id=\'loc\';'
  ]){
    assert.throws(()=>checkLocScopeBoundary([['regression.sql',sql]]),/LOC group table is protected/);
  }
});
