import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {portableShortImportStore} from '../app/loc/import/short-append-service.mjs';
import {authorizeDelegatedShortImport} from '../app/loc/import/short-edge-authorization.mjs';

function fakeStore(){
 const calls=[];
 const trx={};
 const conn={transaction:()=>({execute:async task=>{
  calls.push('begin');
  const output=await task(trx);
  calls.push('commit');
  return output;
 }})};
 const db={
  transaction:()=>conn.transaction(),
  connection:()=>({execute:async fn=>fn(conn)})
 };
 const sql=(parts,...values)=>({
  execute:async()=>{
   const statement=parts.join('?');
   calls.push(statement);
   calls.push({statement,values});
   return /get_lock/.test(statement)?{rows:[{acquired:1}]}:{rows:[]};
  }
 });
 sql.ref=value=>({identifier:value});
 return {db,sql,calls};
}
test('portable Extension source locks use one shared adapter for Postgres, MySQL, SQL Server',async()=>{
 for(const engine of ['postgres','mysql','mssql']){
  const {db,sql,calls}=fakeStore();
  const store=portableShortImportStore(db,sql,{engine,namespace:engine==='mysql'?'':'silver'});
  await store.transaction('lo3rwang',async tx=>{
   await tx.lockSource('gl:'+'a'.repeat(64));
   await tx.lockSource('gl:'+'b'.repeat(64));
  });
  assert.deepEqual(calls.filter(x=>x==='commit'),['commit'],engine);
  if(engine==='postgres')assert.equal(calls.filter(x=>typeof x==='string'&&x.includes('pg_advisory_xact_lock')).length,2);
  if(engine==='mysql'){
   assert.equal(calls.filter(x=>typeof x==='string'&&x.includes('get_lock')).length,2);
   for(const x of calls.filter(x=>typeof x==='object'&&x.statement.includes('get_lock')))
    assert.equal(x.values[0].length,64,'MySQL lock name must be a 64-character hash');
   assert.equal(calls.filter(x=>typeof x==='string'&&x.includes('release_lock')).length,2);
   assert.ok(calls.indexOf('commit')<calls.findIndex(x=>typeof x==='string'&&x.includes('release_lock')));
  }
  if(engine==='mssql')assert.equal(calls.filter(x=>typeof x==='string'&&x.includes('tablockx,holdlock')).length,1);
 }
});
test('short-import store never permits arbitrary Scope or SQL target from Extension',async()=>{
 const {db,sql}=fakeStore();
 const store=portableShortImportStore(db,sql,{engine:'postgres'});
 assert.throws(()=>store.transaction('bad_scope!',async()=>{}),/Invalid Galaxy Scope/);
 assert.doesNotThrow(()=>store.transaction('newscope',async()=>{}));
 assert.throws(()=>portableShortImportStore(db,sql,{engine:'sqlite'}),/unavailable/);
 assert.throws(()=>portableShortImportStore(db,sql,{engine:'mssql',namespace:'x;DROP'}),/namespace/);
});
test('new Scope short-import requires its exact signed write grant, not a fixed Scope list',()=>{
 const body={kind:'short-import',scopeid:'newscope',batch:{id:'batch'}};
 const claims={provider:'loc',me:true,sub:'verified-user',grants:['newscope:write']};
 assert.equal(authorizeDelegatedShortImport(body,claims).scopeid,'newscope');
 assert.throws(()=>authorizeDelegatedShortImport(body,{...claims,grants:['lo3rwang:write']}),/Scope write delegation required/);
 assert.throws(()=>authorizeDelegatedShortImport({...body,scopeid:'new_scope'},claims),/Invalid native short-import payload/);
});
test('Galaxy Link keeps its own persistent Queue and native PKCE OAuth',()=>{
 const background=readFileSync(new URL('../extensions/loc-galaxy-link/background.js',import.meta.url),'utf8');
 const website=readFileSync(new URL('../public/extension/website-bridge.mjs',import.meta.url),'utf8');
 assert.match(background,/chrome\.identity\.launchWebAuthFlow/);
 assert.match(background,/registeredClient\(/);
 assert.match(background,/await acknowledgeBatch\(records\)/);
 assert.match(background,/validateArticleReceipts\(/);
 assert.match(background,/const DB_NAME='loc-channel1-queue'/);
 assert.doesNotMatch(website,/authorization:|getToken/);
});

test('Extension does not depend on a standalone SQL Gateway deployment',()=>{
 for(const file of ['services/loc-sql/main.ts','services/loc-mcp-sql/main.ts']){
  assert.equal(existsSync(new URL('../'+file,import.meta.url)),false,file);
 }
});

