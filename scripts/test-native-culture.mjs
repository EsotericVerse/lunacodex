import test from 'node:test';
import assert from 'node:assert/strict';
import {handleNativeCulture} from '../app/loc/server/native-culture.mjs';

const page=(view,scope='lo3rwang',extra='')=>
  new Request('https://loc.lo3rwang.cc/api/loc-culture?view='+view+
    '&scope='+scope+(extra?'&'+extra:''));
function mockDatabase(){
  const calls=[];
  const query=table=>{
    const state={table,filters:[]};calls.push(state);
    const self={
      select(columns){state.columns=columns;return self;},
      where(...args){state.filters.push(args);return self;},
      groupBy(value){state.groupBy=value;return self;},
      orderBy(...args){state.order=args;return self;},
      limit(n){state.limit=n;return self;},
      offset(n){state.offset=n;return self;},
      execute:async()=>[table.endsWith('_anchor')?
        {uid:'Ab12Cd34',type:'era',title:'時代',attr:{}}:
        state.groupBy?{date:'2026-11-08',site:'threads',item_count:'2'}:
        {uid:'Ab12Cd34',date:'2026-11-08',title:'公開文章',list:true}]
    };
    self.select=e=>{state.columns=e;return self};
    return self;
  };
  const db={selectFrom:query};
  return {calls,database:async()=>({engine:'postgres',db})};
}
test('Culture rejects caller SQL, aliases and unsupported Scope before opening a connection',async()=>{
  let calls=0;const database=async()=>{calls++;throw Error('not allowed');};
  for(const suffix of [
    'view=sql&scope=loc',
    'view=culture_anchors&scope=notpublished',
    'view=culture_anchors&scope=loc&sql=select',
    'view=culture_density&scope=loc&start=2026-11-08',
    'view=culture_list&scope=loc&start=2026-11-01&end=2026-11-08&site=',
    'view=culture_density&scope=loc&start=2026-11-09&end=2026-11-08'
  ]){
    const res=await handleNativeCulture(
      new Request('https://loc.lo3rwang.cc/api/loc-culture?'+suffix),{},database);
    assert.equal(res.status,400,suffix);
  }
  assert.equal(calls,0);
});
test('unconfigured native driver fails closed; response does not leak connection credentials',async()=>{
  const response=await handleNativeCulture(page('culture_anchors'),{},
    async()=>{throw Error('postgresql://secret:pass@db.invalid')});
  assert.equal(response.status,503);
  assert.ok(!(await response.text()).includes('secret'));
});
test('Culture anchor request uses fixed native Anchor relation',async()=>{
  const m=mockDatabase();
  const response=await handleNativeCulture(page('culture_anchors'),{},m.database);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data[0].attr,{});
  assert.equal(m.calls.length,1);
  assert.equal(m.calls[0].table,'silver.lo3rwang_anchor');
  assert.ok(m.calls[0].filters.some(f=>f[0]==='invisible'&&f[2]===false));
});
