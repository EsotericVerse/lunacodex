import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('legacy Scope lifecycle retires Silver forwarding wrappers before API implementations',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261106120000_retire_legacy_api_scope_lifecycle.sql',import.meta.url),'utf8');
  const drops=[
    'silver.delete_scope(text)',
    'silver.provision_scope(text,text,text,date,text,text,text,text,boolean)',
    'api.delete_scope(text)',
    'api.provision_scope(text,text,text,date,text,text,text,text,boolean)'
  ];
  let previous=-1;
  for(const name of drops){
    const index=sql.indexOf('DROP FUNCTION IF EXISTS '+name+' RESTRICT;');
    assert.ok(index>previous,'Correct safe retirement order: '+name);
    previous=index;
  }
  assert.match(sql,/p\.oid NOT IN/);
  assert.match(sql,/FROM pg_depend/);
  assert.doesNotMatch(sql,/\b(?:CASCADE|DROP TABLE|DELETE FROM|TRUNCATE)\b/i);
});
