import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {portableShortImportStore} from '../app/loc/import/short-append-service.mjs';
import {authorizeDelegatedShortImport} from '../app/loc/import/short-edge-authorization.mjs';
import {createLocGatewayAdapter} from '../app/loc/providers/loc-gateway.mjs';

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
 assert.throws(()=>authorizeDelegatedShortImport({...body,scopeid:'new_scope'},claims),/Invalid short-import gateway payload/);
});
test('LOC browser bridge uses only independent gateway for short import and existing signed delegation',async()=>{
 const previous=process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL;
 process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL='https://sql.example.org/v1/sql';
 const calls=[];
 try{
  const adapter=createLocGatewayAdapter({
   authorityUrl:'https://auth.example.org',
   accountAdapter:{auth:{},getAccessToken:async()=> 'oauth-token'},
   gatewayUrl:'https://legacy.example.org/functions/v1/loc-kysely',
   fetchImpl:async(url,options)=>{
    calls.push({url:String(url),headers:options.headers,body:JSON.parse(options.body)});
    if(String(url)==='https://auth.example.org/v1/delegation')
     return Response.json({access_token:'a.b.c',expires_at:Math.floor(Date.now()/1000)+3600});
    if(String(url)==='https://sql.example.org/v1/sql')
     return Response.json({accepted:true,id:'batch-id',articles:[]});
    throw Error('Unexpected vendor Function access: '+url);
   }
  });
  const response=await adapter.authClient.shortImport('lo3rwang',{
   id:'batch-id',write_mode:'append',records:[]
  });
  assert.equal(response.accepted,true);
  assert.equal(calls.length,2);
  assert.equal(calls[0].body.audience,'sql');
  assert.equal(calls[0].body.scopeid,'lo3rwang');
  assert.deepEqual(calls[0].body.actions,['write']);
  assert.equal(calls[1].url,'https://sql.example.org/v1/sql');
  assert.equal(calls[1].headers.authorization,'Bearer a.b.c');
  assert.ok(calls.every(x=>!x.url.includes('/functions/v1/')));
 }finally{
  if(previous===undefined)delete process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL;
  else process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL=previous;
 }
});
test('absent independent gateway fails closed and leaves Extension Queue available',async()=>{
 const previous=process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL;
 delete process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL;
 try{
  const adapter=createLocGatewayAdapter({
   accountAdapter:{auth:{},getAccessToken:async()=> 'token'},
   gatewayUrl:'https://legacy.example.org/functions/v1/loc-kysely'
  });
  assert.throws(()=>adapter.authClient.shortImport('lo3rwang',{}),/獨立 SQL Gateway 尚未設定/);
 }finally{
  if(previous!==undefined)process.env.NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL=previous;
 }
});
test('gateway accepts only LOC website preflight, verifies signed SQL grant before short-import',()=>{
 const gateway=readFileSync(new URL('../services/loc-mcp-sql/main.ts',import.meta.url),'utf8');
 assert.match(gateway,/kind==='short-import'/);
 assert.match(gateway,/verifySignedDelegation\(request,body,false\)/);
 assert.match(gateway,/authorizeDelegatedShortImport\(body,claims\)/);
 assert.match(gateway,/processShortImport\(body.batch,actor/);
 assert.match(gateway,/portableShortImportStore\(db,sql/);
 assert.match(gateway,/origin==='https:\/\/loc\.lo3rwang\.cc'/);
 assert.match(gateway,/Access-Control-Allow-Headers/);
 assert.doesNotMatch(gateway,/supabase\.co\/functions/);
});
