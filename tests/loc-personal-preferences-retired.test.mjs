import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('personal preference modules have no surviving copies',()=>{
  for(const path of ["app/loc/preferences/use-loc-feature-settings.js","app/loc/preferences/use-loc-user.js","app/loc/preferences/loc-user-store.mjs","app/loc/providers/kysely-personal.mjs"])
    assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
});
test('Culture, Statistics, Trace, Search have no table-backed preferences',()=>{
  for(const name of ['Culture','Statistics','Trace','Search'])
    assert.doesNotMatch(read('app/modular/features/'+name+'.jsx'),
      /useLocFeatureSettings|loc-user-store|loc_user/);
});
test('native LOC does not expose personal read/write endpoints',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.doesNotMatch(native,/personal-read|personal-write|executeLocPersonal|loc_user/);
  assert.doesNotMatch(read('app/loc/providers/configured.mjs'),
    /nativePersonal|personal-read|personal-write|loc_user/);
});
test('private search still requires a signed Session and Scope access',()=>{
  const backend=read('app/loc/providers/kysely-management.mjs');
  assert.match(backend,/Verified search session required/);
  assert.match(backend,/canLocAccess\(trx,'scope',scope\)/);
  assert.doesNotMatch(backend,/silver\.loc_user/);
});
