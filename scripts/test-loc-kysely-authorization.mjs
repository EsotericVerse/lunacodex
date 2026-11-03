import test from 'node:test';
import assert from 'node:assert/strict';
import {bindLocAuthorization,canManageLoc,locManageRows} from '../app/loc/providers/loc-authorization.mjs';

const identity={provider:'clerk',sub:'user_123456',email:'owner@example.org'};
function fixture({entries=[],blacklist={email:[]}}={}){
  const hits={loc:0,manage:0};
  const db={fn(name,columns){return {name,columns}},selectFrom(name){
    const key=name.split('.').pop();
    hits[key]++;
    return {
      select(){return this},where(){return this},orderBy(){return this},
      async executeTakeFirst(){return {blacklist}},
      async execute(){return entries}
    };
  }};
  return {db,hits};
}
test('LOC admin uses one cached Kysely permission snapshot, with no legacy RPC',async()=>{
  const {db,hits}=fixture({entries:[{id:'admin',email:identity.email,manage_role:'admin',active:false}]});
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(db,'global'),true);
  assert.equal(await canManageLoc(db,'scope','lrunes'),true);
  assert.equal(await canManageLoc(db,'group','loc'),true);
  assert.deepEqual(hits,{loc:1,manage:1});
  assert.equal((await locManageRows(db,'self'))[0].role,'admin');
  assert.deepEqual(hits,{loc:1,manage:1});
});
test('Scope owner cannot administer a different scope or root',async()=>{
  const {db}=fixture({entries:[{id:'lrunes',email:identity.email,manage_role:'scope',active:true}]});
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(db,'scope','lrunes'),true);
  assert.equal(await canManageLoc(db,'scope','lo3rwang'),false);
  assert.equal(await canManageLoc(db,'global'),false);
});
test('Group administrator can administer loc group but cannot impersonate global admin',async()=>{
  const {db}=fixture({entries:[{id:'loc',email:identity.email,manage_role:'group',active:true}]});
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(db,'group','loc'),true);
  assert.equal(await canManageLoc(db,'scope','loc'),true);
  assert.equal(await canManageLoc(db,'global'),false);
});
test('Blacklist and disabled scope deny access without trying legacy RPC',async()=>{
  const a=fixture({blacklist:{email:[{email:'OWNER@example.org'}]},
    entries:[{id:'admin',email:identity.email,manage_role:'admin',active:true}]});
  bindLocAuthorization(a.db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(a.db,'global'),false);
  assert.deepEqual(a.hits,{loc:1,manage:0});
  const b=fixture({entries:[{id:'lrunes',email:identity.email,manage_role:'scope',active:false}]});
  bindLocAuthorization(b.db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(b.db,'scope','lrunes'),false);
});
test('Unverified or non-Clerk identity cannot acquire manager rights',async()=>{
  const {db}=fixture();
  assert.throws(()=>bindLocAuthorization(db,{role:'authenticated',claims:{...identity,provider:'supabase'}}),{httpStatus:403});
  assert.equal(await canManageLoc(db,'global'),false);
  bindLocAuthorization(db,{role:'anon'});
  assert.equal(await canManageLoc(db,'scope','lrunes'),false);
});
