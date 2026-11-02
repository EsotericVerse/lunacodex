import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyPortableSqlRequest,assertPortableSqlAuthority} from '../workers/loc-authority/sql-authorization.mjs';

const query=(table,operation='select')=>({kind:'query',schema:'silver',table,operation});
const identity={provider:'clerk',subject:'user_ABC123'};
test('portable public reads are narrowly restricted and never imply public writes',async()=>{
  for(const table of ['runes','runes_etc','runes_group']){
    assert.equal(classifyPortableSqlRequest(query(table)).public,true);
    assert.equal((await assertPortableSqlAuthority(query(table))).public,true);
    await assert.rejects(assertPortableSqlAuthority(query(table,'update')),/Unmapped resource|Verified identity|not permitted/);
  }
});
test('private writes require verified identity and exact scope grant independent of SQL engine',async()=>{
  const allowed=({scope,action})=>scope==='lo3rwang'&&action==='write';
  assert.equal((await assertPortableSqlAuthority(query('lo3rwang_galaxy','update'),{identity,mayAccess:allowed})).scope,'lo3rwang');
  await assert.rejects(assertPortableSqlAuthority(query('lrunes_galaxy','update'),{identity,mayAccess:allowed}),/not permitted/);
  await assert.rejects(assertPortableSqlAuthority(query('lo3rwang_galaxy'),{identity,mayAccess:allowed}),/not permitted/);
  await assert.rejects(assertPortableSqlAuthority(query('lo3rwang_galaxy','update'),{}),/Verified identity/);
});
test('unknown global resources, RPC and invalid SQL identifiers fail closed',()=>{
  for(const req of [
    {kind:'rpc',schema:'silver',name:'management_write'},
    query('manage'),query('some_table_that_is_not_a_scope'),
    {...query('lo3rwang_galaxy'),schema:'api'},
    query('lo3rwang_galaxy;drop')
  ])assert.throws(()=>classifyPortableSqlRequest(req));
});
