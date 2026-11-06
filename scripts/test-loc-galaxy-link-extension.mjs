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
  {textContent:'真正內容',parentElement:parent},
  {textContent:'第二段文字',parentElement:parent}
 ];
 let at=0;
 const doc={title:'標題',body:{},querySelector:()=>({}),
  createTreeWalker:()=>({nextNode:()=>nodes[at++]||null})};
 const result=parse(doc,{SHOW_TEXT:4},()=>({display:'block',visibility:'visible'}),
  {href:'https://example.org',hostname:'example.org'});
 assert.equal(result.content,'真正內容\n第二段文字');
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
 const fn=new Function('MAX_TEXT_CHARS','crypto','enqueue',
  between('async function enqueuePage(record){','function batches(records){')+'return enqueuePage;')(
   140000,{randomUUID:()=>String(++seq)},async item=>written.push(item));
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
