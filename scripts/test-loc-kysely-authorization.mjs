import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {bindLocAuthorization,canManageLoc,locManageRows} from '../app/loc/providers/loc-authorization.mjs';

const identity={provider:'loc',me:true,sub:'user_123456',email:'sopa2306@gmail.com',
  grants:['global:manage']};
const ownerAdmin={id:'lo3rwang',email:identity.email,manage_role:'admin',active:true};
function fixture(entries=[]){
  const hits={manage:0};
  const db={fn(name,columns){return {name,columns}},selectFrom(name){
    assert.ok(['api.manage','api.manage as m'].includes(name));
    hits.manage++;
    let email='';
    return {
      leftJoin(name){assert.equal(name,'silver.loc as s');return this},
      select(){return this},
      where(_column,_operator,value){if(typeof value==='string'&&value.includes('@'))email=value;return this},
      orderBy(){return this},
      async execute(){return entries.filter(row=>!email||row.email.toLowerCase()===email).map(row=>({...row}))}
    };
  }};
  return {db,hits};
}
test('LOC signed Admin delegation also requires matching active api.manage Admin',async()=>{
  const {db,hits}=fixture([ownerAdmin,{id:'admin',email:identity.email,manage_role:'admin',active:false}]);
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  assert.equal(await canManageLoc(db,'global'),true);
  assert.equal(await canManageLoc(db,'scope','lrunes'),true);
  assert.deepEqual(hits,{manage:1},'one registry query per bound transaction');
});
test('without LOC Auth management grant, a database row does not grant writes',async()=>{
  const {db}=fixture([ownerAdmin]);
  bindLocAuthorization(db,{role:'authenticated',claims:{...identity,grants:[]}});
  assert.equal(await canManageLoc(db,'global'),false);
  assert.equal(await canManageLoc(db,'scope','lo3rwang'),false);
});
test('another verified email cannot inherit an Admin row owned by someone else',async()=>{
  const {db}=fixture([ownerAdmin]);
  bindLocAuthorization(db,{role:'authenticated',claims:{...identity,
    email:'reader@example.org',grants:['global:manage']}});
  assert.equal(await canManageLoc(db,'global'),false);
});
test('an explicit Scope delegation never becomes global Admin',async()=>{
  const {db}=fixture([{id:'lrunes',email:identity.email,manage_role:'scope',active:true}]);
  bindLocAuthorization(db,{role:'authenticated',claims:{...identity,grants:['lrunes:manage']}});
  assert.equal(await canManageLoc(db,'global'),false);
  assert.equal(await canManageLoc(db,'scope','lrunes'),true);
  assert.equal(await canManageLoc(db,'scope','lo3rwang'),false);
});
test('Manage self view reports roles only after actual database check',async()=>{
  const {db}=fixture([ownerAdmin]);
  bindLocAuthorization(db,{role:'authenticated',claims:identity});
  const rows=await locManageRows(db,'self');
  assert.equal(rows[0].role,'admin');
  assert.equal(rows[0].allowed,true);
});
test('unverified external and anonymous identities cannot write',async()=>{
  const {db}=fixture([ownerAdmin]);
  assert.throws(()=>bindLocAuthorization(db,{role:'authenticated',
    claims:{...identity,provider:'clerk'}}),{httpStatus:403});
  assert.throws(()=>bindLocAuthorization(db,{role:'authenticated',
    claims:{...identity,me:false}}),{httpStatus:403});
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
      email:'sopa2306@gmail.com'},engine:'mysql',namespace:''});
  assert.equal(result.data.count,2);
  assert.equal(writes,2);
  assert.equal(reads,1);
});
