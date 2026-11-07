import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {assertCrossEnginePublicRead,CROSS_ENGINE_PUBLIC_READ_TABLES} from '../app/loc/providers/sql-engine-ports.mjs';

test('cross-engine Kysely reads remain usable for public references',()=>{
  for(const table of CROSS_ENGINE_PUBLIC_READ_TABLES){
    assert.doesNotThrow(()=>assertCrossEnginePublicRead({kind:'query',operation:'select',schema:'silver',table}));
  }
  assert.deepEqual(CROSS_ENGINE_PUBLIC_READ_TABLES,['runes','runes_etc','runes_group']);
});
test('cross-engine SQL exposes only published Scope rows and explicitly public account tables',()=>{
  for(const table of ['lo3rwang_keywords','keyword_classes','game','lrunes_daily','manage']){
    assert.throws(()=>assertCrossEnginePublicRead({kind:'query',operation:'select',schema:'silver',table}),
      error=>error.httpStatus===403);
  }
  for(const table of ['lo3rwang_galaxy','lrunes_galaxy']){
    assert.equal(assertCrossEnginePublicRead({kind:'query',operation:'select',schema:'silver',table}).publicOnly,true);
  }
  for(const table of ['lo3rwang','lrunes','loc','loc_blocks']){
    assert.equal(assertCrossEnginePublicRead({kind:'query',operation:'select',schema:'silver',table}).publicOnly,false);
  }
  for(const table of ['manage','loc_user','user_settings']){
    assert.equal(assertCrossEnginePublicRead({kind:'query',operation:'select',schema:'api',table}).publicOnly,false);
  }
  for(const operation of ['insert','update','delete','upsert']){
    assert.throws(()=>assertCrossEnginePublicRead({kind:'query',operation,schema:'silver',table:'runes'}),
      error=>error.httpStatus===403);
  }
  assert.throws(()=>assertCrossEnginePublicRead({kind:'rpc',schema:'silver',name:'management_write'}));
  assert.throws(()=>assertCrossEnginePublicRead({kind:'query',operation:'select',schema:'api',table:'user_records'}));
});
test('production Kysely Edge always enforces the external permission boundary',()=>{
  const source=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(source,/assertCrossEnginePublicRead\(body\)/);
  assert.doesNotMatch(source,/neonLocReadTables/);
});

test('Kysely Edge no longer references a deleted Neon table-name allowlist',()=>{
  const source=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/neonLocReadTables/);
  const checks=[...source.matchAll(/assertCrossEnginePublicRead\(body\)/g)];
  assert.ok(checks.length>=1,'cross-engine permissions must be checked before connection');
  assert.match(source,/if\(target\.provider==="neon"&&\(body\.schema!=="silver"/);
  assert.match(source,/if\(target\.provider==="custom"\|\|target\.engine!=="postgres"\)/);
});
