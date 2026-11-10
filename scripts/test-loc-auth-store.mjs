import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createLocAuthSqlState} from '../app/loc/auth/sql-state-store.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
// Minimal query-builder double, including optimistic revision deletes.
function database() {
 const rows = new Map();
 const keyFor = row => row.bucket + '|' + row.state_key;
 function statement(type) {
  const filters=[], options={};
  const fits = row => filters.every(([field,op,value]) => op === '='
    ? row[field] === value
    : op === 'like' ? row[field].startsWith(value.slice(0,-1)) : false);
  const api={
   select(){return api;}, set(v){options.set=v;return api;},
   values(v){options.values=v;return api;},
   where(field,op,value){filters.push([field,op,value]);return api;},
   onConflict(fn){fn({columns:()=>({doUpdateSet:v=>{options.upsert=v;}})});return api;},
   onDuplicateKeyUpdate(v){options.upsert=v;return api;},
   orderBy(){return api;},limit(n){options.limit=n;return api;},
   async executeTakeFirst(){return [...rows.values()].find(fits);},
   async execute(){
    if(type==='select')return [...rows.values()].filter(fits).slice(0,options.limit);
    if(type==='insert'){
      const k=keyFor(options.values);
      if(rows.has(k)){
       if(!options.upsert)throw Object.assign(new Error('duplicate'),{code:'23505'});
       rows.set(k,{...rows.get(k),...options.upsert});
      }else rows.set(k,options.values);
      return [{numAffectedRows:1n}];
    }
    let count=0;
    for(const [k,row] of [...rows]){
     if(!fits(row))continue;
     count++;
     if(type==='delete')rows.delete(k);
     else rows.set(k,{...row,...options.set});
    }
    return [{numDeletedRows:type==='delete'?BigInt(count):undefined,
      numUpdatedRows:type==='update'?BigInt(count):undefined}];
   }
  };
  return api;
 }
 return {rows,
  db:{selectFrom:()=>statement('select'),insertInto:()=>statement('insert'),
    updateTable:()=>statement('update'),deleteFrom:()=>statement('delete')}};
}
// Only PostgreSQL is an installed SQL runtime. Keep the full Auth Store
// atomic-consumption regression test on the actual supported driver.
for (const engine of ['postgres']) {
 test('LOC Auth SQL '+engine+' stores hashed keys and atomically takes tokens',async()=>{
  const {rows,db}=database();
  const s=createLocAuthSqlState(db,{engine});
  const key='native-refresh:TEST_TOKEN_HASH';
  const value={sidHash:'private-digest',client_id:'loc-mcp-1',
    expires:Date.now()+60000};
  await s.put(key,value);
  assert.deepEqual(await s.get(key),value);
  const [a,b]=await Promise.all([s.take(key),s.take(key)]);
  assert.equal([a,b].filter(Boolean).length,1,'token may be consumed once');
  assert.equal(await s.get(key),undefined);
  assert.equal(rows.size,0);
  await s.put('native-session:abc',{expires:Date.now()+60000,subject:'loc_a'});
  await s.put('native-session:def',{expires:Date.now()-1000,subject:'loc_b'});
  const listed=await s.list({prefix:'native-session:'});
  assert.deepEqual([...listed.keys()],['native-session:abc']);
  await s.delete('native-session:abc');
  assert.equal(await s.get('native-session:abc'),undefined);
 });
}


test('LOC Auth rejects disabled MySQL and MSSQL SQL stores without accessing data',()=>{
 for(const engine of ['mysql','mssql']){
  const {rows,db}=database();
  assert.throws(()=>createLocAuthSqlState(db,{engine}),
   /Invalid trusted LOC Auth Kysely store/);
  assert.equal(rows.size,0);
 }
});
