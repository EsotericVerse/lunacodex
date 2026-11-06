import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const text=readFileSync(new URL('../extensions/loc-galaxy-link/background.js',import.meta.url),'utf8');
const between=(a,b)=>{
 const from=text.indexOf(a),to=text.indexOf(b);
 assert.ok(from>=0&&to>from,'missing extension function '+a);
 return text.slice(from,to);
};
test('DOM extraction uses page content, not highlighted selection',()=>{
 const parse=new Function('document','NodeFilter','getComputedStyle','location',
  between('function parsePage(){','async function capture(')+'return parsePage();');
 const parent={closest:()=>null},nodes=[
  {textContent:'這是第一段真正的網頁內容',parentElement:parent},
  {textContent:'這是第二段網頁內容',parentElement:parent}
 ];
 let at=0;
 const doc={title:'標題',body:{},querySelector:()=>({}),
  createTreeWalker:()=>({nextNode:()=>nodes[at++]||null})};
 const result=parse(doc,{SHOW_TEXT:4},()=>({display:'block',visibility:'visible'}),
  {href:'https://example.org',hostname:'example.org'});
 assert.equal(result.content,'這是第一段真正的網頁內容\n這是第二段網頁內容');
 assert.equal(result.source,'example.org');
 assert.equal(result.completeness,'loaded-dom-only');
 assert.equal(text.includes('selectionText'),false);
});
test('batch packing limits number and encoded bytes',()=>{
 const batches=new Function('TextEncoder','MAX_BATCH_BYTES',
  between('function batches(records){','async function stableBatchId(')+'return batches;')(
   TextEncoder,600000);
 const records=Array.from({length:100},(_,i)=>({id:String(i),content:'A'.repeat(10000)}));
 const result=batches(records);
 assert.deepEqual(result.map(b=>b.length),[50,50]);
 for(const b of result)assert.ok(new TextEncoder().encode(JSON.stringify({id:'uuid',records:b})).length<=600000);
});
test('Unicode-safe splitting never truncates long webpages',async()=>{
 const written=[];let seq=0;
 const fn=new Function('MAX_TEXT_CHARS','crypto','enqueue','sourceKey',
  between('async function enqueuePage(record){','function batches(records){')+'return enqueuePage;')(
   140000,{randomUUID:()=>String(++seq)},async item=>written.push(item),u=>u);
 const content='漢'.repeat(140000)+'😀'+'字'.repeat(140000);
 assert.equal(await fn({content,title:'test'}),3);
 assert.equal(written.map(x=>x.content).join(''),content);
 assert.deepEqual(written.map(x=>x.part_index),[0,1,2]);
 assert.ok(written.every(x=>x.part_count===3));
});

test('LOC native OAuth replaces all Clerk bridge and KV upload wiring',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../extensions/loc-galaxy-link/manifest.json',import.meta.url),'utf8'));
 const options=readFileSync(new URL('../extensions/loc-galaxy-link/options.html',import.meta.url),'utf8');
 assert.ok(manifest.permissions.includes('identity'));
 assert.ok(text.includes('chrome.identity.launchWebAuthFlow'));
 assert.ok(text.includes("code_challenge_method:'S256'"));
 assert.ok(text.includes("grant_type:'refresh_token'"));
 assert.ok(text.includes("config.import_url"));
 assert.ok(!text.includes("+'/v1/batch'"));
 assert.ok(!text.includes("KV Worker URL"));
 assert.ok(!options.includes('clerk.accounts.dev'));
 assert.ok(!options.includes('id="token"'));
});
test('stale Clerk config fails closed instead of opening a Clerk login',async()=>{
 const source=text.slice(text.indexOf('function oauthError('),text.indexOf('async function exchange('));
 const getConfig=new Function('fetch','URL','chrome','CONFIG_URL',source+'return getConfig;')(
  async()=>({ok:true,json:async()=>({issuer:'https://legacy.clerk.accounts.dev',
    client_id:'old-id',import_url:'https://loc.lo3rwang.cc/import'})}),
  URL,{storage:{local:{set:async()=>{throw Error('must not persist Clerk config');}}}},
  'https://loc.lo3rwang.cc/extension/oauth/config.json');
 await assert.rejects(getConfig(),/LOC 自有認證尚未啟用/);
});

test('LOC 彩虹橋品牌版本與網站 favicon 綁定',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../extensions/loc-galaxy-link/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.name,'LOC galaxy-link｜LOC 彩虹橋');
 assert.equal(manifest.version,'0.1.0');
 assert.equal(manifest.icons['128'],'icons/loc-favicon.png');
 assert.ok(manifest.action.default_icon['16']);
 assert.ok(text.includes("const DB_NAME='loc-channel1-queue'"),'preserve unsent IndexedDB items');
});


function queueHelpers(){
 const sourceKey=new Function('URL',between('function sourceKey(url){','function orderedPending(records){')+
  'return sourceKey;')(URL);
 const helpers=new Function('MAX_BATCH_BYTES','AUTO_BATCH_CAPTURES','TextEncoder',
  between('function orderedPending(records){','async function enqueuePage(record){')+
  'return {orderedPending,queueReady};')(600000,10,TextEncoder);
 return {sourceKey,...helpers};
}
function flushHarness({records=[],fetchReply,manual=false}={}){
 const {sourceKey,orderedPending,queueReady}=queueHelpers();
 const state={},metrics={tokenCalls:0,requests:[],acknowledged:[]};
 const chrome={storage:{local:{
   get:async key=>key==='locConfig'?
    {locConfig:{import_url:'https://loc.lo3rwang.cc/v1/import/short'}}:
    Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,state[k]])),
   set:async data=>Object.assign(state,data),
   remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete state[key];}
 }}};
 const body=between('function validateArticleReceipts(receipts,records){','chrome.runtime.onInstalled');
 const flush=new Function('activeToken','allPending','chrome','batches','stableBatchId',
  'fetch','acknowledgeBatch','oauthError','orderedPending','queueReady','sourceKey',
  'let processing=null;'+body+'return flush;')(
  async()=>{metrics.tokenCalls++;return 'loc-access-token';},
  async()=>[...records],chrome,
  items=>[items],async()=> 'batch-1',
  async (url,options)=>{metrics.requests.push(JSON.parse(options.body));
   return fetchReply?fetchReply(url,options,metrics.requests.length):
    {ok:true,json:async()=>({accepted:true,id:'batch-1',articles:[
     ...new Set(metrics.requests.at(-1).records.map(r=>r.source_key))].map((key,i)=>({
      source_key:key,uid:i===0?'Ab12Cd34':'Cd34Ef56'}))})};},
  async items=>metrics.acknowledged.push(items.map(r=>r.id)),
  message=>Error('LOC Auth：'+message),
  orderedPending,queueReady,sourceKey);
 return {flush,metrics,state};
}
test('Queue threshold counts captures, not chunks; large payload also triggers',()=>{
 const {sourceKey,queueReady,orderedPending}=queueHelpers();
 assert.equal(sourceKey('https://example.org/#/post/1'),'https://example.org/#/post/1');
 const nine=Array.from({length:9},(_,i)=>({id:'id-'+i,group_id:'g-'+i,
  content:'text',captured_at:'2026-11-07T00:00:00Z'}));
 assert.equal(queueReady(nine),false);
 assert.equal(queueReady([...nine,{id:'last',group_id:'g-last',content:'text'}]),true);
 assert.equal(queueReady(Array.from({length:7},(_,i)=>({...nine[0],id:'chunk-'+i}))),false);
 assert.equal(queueReady([{id:'large',group_id:'large',content:'字'.repeat(210000)}]),true);
 const chunks=orderedPending([
  {id:'b',group_id:'same',part_index:1,captured_at:'2026-11-07T00:00:00Z'},
  {id:'a',group_id:'same',part_index:0,captured_at:'2026-11-07T00:00:00Z'}]);
 assert.deepEqual(chunks.map(x=>x.part_index),[0,1]);
});
test('Queue below threshold does not authenticate or send',async()=>{
 const h=flushHarness({records:[{id:'1',group_id:'capture',url:'https://example.org/a',
  captured_at:'2026-11-07T00:00:00Z'}]});
 assert.equal(await h.flush(),0);
 assert.equal(h.metrics.tokenCalls,0);
 assert.equal(h.metrics.requests.length,0);
});
test('Queue flush transfers multiple sources once with append-only mode and UID receipts',async()=>{
 const records=Array.from({length:10},(_,i)=>({id:'event-'+i,group_id:'capture-'+i,
  url:i%2?'https://example.org/b':'https://example.org/a',
  captured_at:'2026-11-07T00:00:00Z',content:'a'}));
 const h=flushHarness({records});
 assert.equal(await h.flush(),10);
 assert.equal(h.metrics.requests.length,1);
 assert.equal(h.metrics.tokenCalls,1);
 assert.equal(h.metrics.requests[0].write_mode,'append');
 assert.equal(new Set(h.metrics.requests[0].records.map(r=>r.source_key)).size,2);
 assert.ok(h.metrics.requests[0].records.every(r=>r.write_mode==='append'&&r.kind==='capture'));
 assert.equal(h.metrics.acknowledged.length,1);
 assert.equal(h.metrics.acknowledged[0].length,10);
});
test('Missing article UID receipts preserve Queue and do not acknowledge',async()=>{
 const records=Array.from({length:10},(_,i)=>({id:'event-'+i,group_id:'c-'+i,
  url:'https://example.org/a',captured_at:'2026-11-07T00:00:00Z'}));
 const h=flushHarness({records,fetchReply:async()=>({ok:true,
  json:async()=>({accepted:true,id:'batch-1',articles:[]})})});
 await assert.rejects(h.flush(),/未確認文章 UID/);
 assert.deepEqual(h.metrics.acknowledged,[]);
 assert.equal(h.state.locQueueRetry,true);
});
test('Failed import keeps same event IDs and next attempt appends only once',async()=>{
 const records=Array.from({length:10},(_,i)=>({id:'event-'+i,group_id:'c-'+i,
  url:'https://example.org/a',captured_at:'2026-11-07T00:00:00Z'}));
 let fail=true;
 const h=flushHarness({records,fetchReply:async()=>fail?
  {ok:false,status:503}:
  {ok:true,json:async()=>({accepted:true,id:'batch-1',articles:[
   {source_key:'https://example.org/a',uid:'Ab12Cd34'}]})}});
 await assert.rejects(h.flush(),/HTTP 503/);
 assert.deepEqual(h.metrics.acknowledged,[]);
 fail=false;
 assert.equal(await h.flush(),10);
 assert.equal(h.metrics.requests.length,2);
 assert.deepEqual(h.metrics.requests[0],h.metrics.requests[1]);
 assert.equal(h.metrics.acknowledged.length,1);
});
test('HTTP 429 backs off instead of retrying on every queue alarm',async()=>{
 const records=Array.from({length:10},(_,i)=>({id:'e-'+i,group_id:'c-'+i,
  url:'https://example.org/a',captured_at:'2026-11-07T00:00:00Z'}));
 const h=flushHarness({records,fetchReply:async()=>({ok:false,status:429,
  headers:{get:()=> '900'}})});
 await assert.rejects(h.flush(),/HTTP 429/);
 assert.equal(h.state.locQueueRetry,true);
 assert.ok(h.state.locQueueRetryAfter>Date.now()+890000);
 assert.equal(await h.flush(true),0);
 assert.equal(h.metrics.requests.length,1);
});
test('Batch acknowledgement uses one IndexedDB transaction',async()=>{
 const batchSource=between('async function acknowledgeBatch(records){','async function badge(');
 const deleted=[];let transactions=0,closes=0;
 const db={transaction:()=>{
  transactions++;
  const tx={objectStore:()=>({delete:id=>deleted.push(id)})};
  queueMicrotask(()=>tx.oncomplete());
  return tx;
 },close:()=>{closes++;}};
 const acknowledge=new Function('dbOpen','STORE',batchSource+'return acknowledgeBatch;')(
  async()=>db,'pending');
 await acknowledge([{id:'one'},{id:'two'}]);
 assert.equal(transactions,1);
 assert.deepEqual(deleted,['one','two']);
 assert.equal(closes,1);
});
