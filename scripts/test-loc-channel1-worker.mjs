import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import worker from '../workers/loc-channel1/index.mjs';

function token(secret){
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 const unsigned=enc({alg:'HS256',typ:'JWT'})+'.'+enc({
  iss:'loc-channel1',aud:'loc-kv-inbox',nbf:now-30,exp:now+3600,scopes:['record:create']});
 return unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
}
function kv(){
 const map=new Map();
 return {
  map,
  get:async k=>map.get(k)||null,
  put:async(k,v)=>{map.set(k,v);},
  delete:async k=>{map.delete(k);},
  list:async({prefix,limit})=>({keys:[...map.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name}))})
 };
}
const secret='0123456789abcdef0123456789abcdef';
const record=()=>({
 id:randomUUID(),group_id:randomUUID(),part_index:0,part_count:1,
 title:'標題',source:'chatgpt.com',url:'https://chatgpt.com/c/a',content:'hello',
 captured_at:'2026-11-06T00:00:00.000Z'
});
async function send(env,batch,auth=token(secret)){
 return worker.fetch(new Request('https://loc.example/v1/batch',{
  method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},
  body:JSON.stringify(batch)
 }),env);
}
async function tick(env){
 const running=[];
 await worker.scheduled({},env,{waitUntil(p){running.push(p);}});
 await Promise.all(running);
}
test('rejects unauthorized and malformed batches without writing KV',async()=>{
 const env={LOC_KV:kv(),LOC_CHANNEL1_SECRET:secret};
 const batch={id:randomUUID(),records:[record()]};
 assert.equal((await send(env,batch,'bad')).status,401);
 assert.equal((await send(env,{id:randomUUID(),records:[{...record(),group_id:'invalid'}]})).status,400);
 assert.equal(env.LOC_KV.map.size,0);
});
test('accepts batch once and never calls Galaxy when there is no new KV',async()=>{
 const env={LOC_KV:kv(),LOC_CHANNEL1_SECRET:secret};
 const batch={id:randomUUID(),records:[record()]};
 assert.equal((await send(env,batch)).status,200);
 const duplicate=await (await send(env,batch)).json();
 assert.equal(duplicate.duplicate,true);
 assert.equal(env.LOC_KV.map.size,1);
 let calls=0;const saved=globalThis.fetch;
 globalThis.fetch=async()=>{calls++;throw Error('should not run');};
 try{
  await tick({LOC_KV:kv(),LOC_GALAXY_SYNC_URL:'https://ingest.example',LOC_GALAXY_SYNC_SECRET:'secret'});
  assert.equal(calls,0);
 }finally{globalThis.fetch=saved;}
});
test('failed Galaxy acknowledgement retains pending batch; success archives it',async()=>{
 const env={LOC_KV:kv(),LOC_CHANNEL1_SECRET:secret,
  LOC_GALAXY_SYNC_URL:'https://ingest.example',LOC_GALAXY_SYNC_SECRET:'secret'};
 const batch={id:randomUUID(),records:[record(),record()]};
 await send(env,batch);
 const saved=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({accepted:false}),{status:200});
  await tick(env);
  assert.equal(env.LOC_KV.map.has('pending/'+batch.id),true);
  globalThis.fetch=async()=>new Response(JSON.stringify({accepted:true,id:batch.id,count:2}),{
   status:200,headers:{'content-type':'application/json'}});
  await tick(env);
  assert.equal(env.LOC_KV.map.has('pending/'+batch.id),false);
  assert.equal(env.LOC_KV.map.has('archive/'+batch.id),true);
 }finally{globalThis.fetch=saved;}
});
