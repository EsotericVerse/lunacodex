import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {bindLocAuthorization,canManageLoc,locManageRows} from '../app/loc/providers/loc-authorization.mjs';

const identity={provider:'loc',me:true,sub:'user_123456',email:'owner@example.org',
  grants:['global:manage']};
function fixture({entries=[],blacklist={email:[]}}={}){
  const hits={manage:0};
  const db={fn(name,columns){return {name,columns}},selectFrom(name){
    assert.equal(name,'api.manage as m');
    hits.manage++;
    return {
      crossJoin(name){assert.equal(name,'silver.loc as l');return this},
      leftJoin(name){assert.equal(name,'silver.loc as s');return this},
      select(){return this},where(){return this},orderBy(){return this},
      async execute(){return entries.map(row=>({...row,blacklist}))}
    };
  }};
  return {db,hits};
}
test('LOC signed global delegation authorizes without an authorization SQL round trip',async()=>{
  const {db,hits}=fixture();
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(db,'global'),true);
  assert.equal(await canManageLoc(db,'scope','lrunes'),true);
  assert.equal(await canManageLoc(db,'group','loc'),true);
  assert.deepEqual(hits,{manage:0});
});
test('Scope delegation cannot administer another scope or global registry',async()=>{
  const {db,hits}=fixture();
  bindLocAuthorization(db,{role:'authenticated',claims:
    {...identity,grants:['lrunes:manage']}});
  assert.equal(await canManageLoc(db,'scope','lrunes'),true);
  assert.equal(await canManageLoc(db,'scope','lo3rwang'),false);
  assert.equal(await canManageLoc(db,'global'),false);
  assert.deepEqual(hits,{manage:0});
});
test('Group scope delegation is not global administrator',async()=>{
  const {db}=fixture();
  bindLocAuthorization(db,{role:'authenticated',claims:
    {...identity,grants:['loc:manage']}});
  assert.equal(await canManageLoc(db,'group','loc'),true);
  assert.equal(await canManageLoc(db,'scope','loc'),true);
  assert.equal(await canManageLoc(db,'global'),false);
});
test('Management membership is read only for display, not for authorization',async()=>{
  const {db,hits}=fixture({entries:[{id:'admin',email:identity.email,
    manage_role:'admin',active:true}]});
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  assert.equal((await locManageRows(db,'self'))[0].allowed,true);
  assert.deepEqual(hits,{manage:1});
});
test('No signed grant, non-LOC identity, false ME, or anonymous cannot manage',async()=>{
  const {db}=fixture();
  assert.throws(()=>bindLocAuthorization(db,{role:'authenticated',claims:
    {...identity,provider:'clerk'}}),{httpStatus:403});
  assert.throws(()=>bindLocAuthorization(db,{role:'authenticated',claims:
    {...identity,me:false}}),{httpStatus:403});
  bindLocAuthorization(db,{role:'authenticated',claims:{...identity,grants:[]}});
  assert.equal(await canManageLoc(db,'global'),false);
  bindLocAuthorization(db,{role:'anon'});
  assert.equal(await canManageLoc(db,'scope','lrunes'),false);
});

test('portable Galaxy batch reads existing rows once, not once per article',async()=>{
  const provider=fs.readFileSync('app/loc/providers/sql-engine-ports.mjs','utf8');
  const execute=new Function('canManageLoc',
    provider.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return executeCrossEngineManagedWrite;')(async()=>true);
  const original=[
    {uid:'ABCD1234',title:'old',content:'x',place_id:null,url:null,media_link:null},
    {uid:'EFGH5678',title:'old',content:'y',place_id:null,url:null,media_link:null}
  ];
  let reads=0,writes=0;
  const db={
    selectFrom:()=>({
      select(){return this},where(){return this},
      async execute(){reads++;return original},
      async executeTakeFirst(){reads++;return original[reads-1]||null}
    }),
    updateTable:()=>({
      set(){return this},where(){return this},
      async executeTakeFirst(){writes++;return {numUpdatedRows:1n}}
    })
  };
  const result=await execute(db,{payload:{p_table:'silver.writer_galaxy',
    p_operation:'update_batch',p_rows:[
      {uid:'ABCD1234',title:'new1'},{uid:'EFGH5678',title:'new2'}
    ]}},{role:'authenticated',claims:{provider:'loc',me:true,sub:'user_123456',
      email:'owner@example.org'},engine:'mysql',namespace:''});
  assert.equal(result.data.count,2);
  assert.equal(writes,2);
  assert.equal(reads,1);
});
