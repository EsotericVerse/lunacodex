import test from 'node:test';
import assert from 'node:assert/strict';
import {createShortImportHttpHandler} from '../app/loc/import/short-import-http.mjs';
const actor={authorized:true,subject:'loc-user-verified-01',scopeid:'lo3rwang'};
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const capture={id:uuid(1),group_id:uuid(11),source_key:'https://example.org/one',
 url:'https://example.org/one',title:'測試文章',content:'第一段文章內容',
 write_mode:'append',kind:'capture',part_index:0,part_count:1,
 captured_at:'2026-11-07T01:00:00Z'};
const batch={id:uuid(30),write_mode:'append',records:[capture]};
const cryptoProvider={subtle:{async digest(){return new Uint8Array(32).fill(3).buffer;}}};
const goodToken='A'.repeat(50);
const request=(body=batch,auth=true)=>new Request('https://loc.lo3rwang.cc/v1/import/short',{
 method:'POST',headers:{'content-type':'application/json',
 ...(auth?{authorization:'Bearer '+goodToken}:{})},
 body:JSON.stringify(body)});
function store(){
 const saved=new Map();
 return {saved,transaction:async(_,fn)=>fn({
  async lockSource(){},
  async lookup(k){const r=saved.get(k);return r?[{uid:r.uid,content:r.content}]:[];},
  async insert(row){saved.set(row.site_id,{...row});},
  async append(uid,k,content){const r=saved.get(k);assert.equal(uid,r.uid);r.content+=content;}
 })};
}
test('HTTP endpoint fails closed when LOC Auth or Kysely writer is not configured',async()=>{
 const reply=await createShortImportHttpHandler()(request());
 assert.equal(reply.status,503);
});
test('missing, expired or denied LOC bearer cannot write',async()=>{
 const db=store(),opts={store:db,verifyAccessToken:async token=>{
  if(token!=='valid')throw Error('Invalid');return actor;}};
 const handler=createShortImportHttpHandler(opts);
 assert.equal((await handler(request(batch,false))).status,401);
 assert.equal((await handler(request())).status,401);
 assert.equal(db.saved.size,0);
});
test('verified identity may append a batch and receive source UID receipts',async()=>{
 const db=store();
 const handler=createShortImportHttpHandler({store:db,cryptoProvider,
  uidFactory:()=> 'Ab12Cd34',verifyAccessToken:async token=>{
   assert.equal(token,goodToken);return actor;}});
 const res=await handler(request());
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.accepted,true);
 assert.equal(body.id,batch.id);
 assert.deepEqual(body.articles.map(x=>({source_key:x.source_key,uid:x.uid})),
  [{source_key:capture.source_key,uid:'Ab12Cd34'}]);
 const original=[...db.saved.values()][0].content;
 const retry=await handler(request());
 assert.equal(retry.status,200);
 assert.equal([...db.saved.values()][0].content,original);
 assert.equal((await retry.json()).articles[0].duplicate,true);
});
test('request body cannot override the verified user or Scope',async()=>{
 const db=store(),handler=createShortImportHttpHandler({
  store:db,cryptoProvider,uidFactory:()=> 'Ab12Cd34',
  verifyAccessToken:async()=>actor});
 const tampered={...batch,scopeid:'lrunes',actor:{authorized:true,subject:'other'}};
 const result=await handler(request(tampered));
 assert.equal(result.status,400);
 assert.equal(db.saved.size,0);
});
test('authenticated writer cooldown is surfaced as 429 with Retry-After',async()=>{
 const handler=createShortImportHttpHandler({cryptoProvider,
  verifyAccessToken:async()=>actor,store:{transaction:async()=>{
   const error=new Error('Quota active');error.httpStatus=429;error.retryAfter=300;
   throw error;
  }}});
 const response=await handler(request());
 assert.equal(response.status,429);
 assert.equal(response.headers.get('retry-after'),'300');
});
