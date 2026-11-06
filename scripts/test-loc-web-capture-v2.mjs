import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script,createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
import {createLocGatewayAdapter} from '../app/loc/providers/loc-gateway.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'../extensions/loc-web-capture-v2');
const text=name=>readFileSync(join(root,name),'utf8');
const manifest=JSON.parse(text('manifest.json'));

test('independent extension is MV3 and does not request identity or MCP privileges',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.equal(manifest.background.service_worker,'background.js');
 assert.ok(!manifest.permissions.includes('identity'));
 assert.ok(!manifest.host_permissions.some(s=>s.includes('mcp.')));
 assert.ok(!manifest.host_permissions.some(s=>s.includes('clerk')));
 assert.deepEqual(manifest.host_permissions,['https://loc.lo3rwang.cc/*']);
});

test('extension scripts and vendored Readability compile',()=>{
 for(const name of ['background.js','content.js','popup.js','vendor/Readability.js'])
  assert.doesNotThrow(()=>new Script(text(name),{filename:name}));
});

test('only one IndexedDB queue; no OAuth token storage or Auth retries',()=>{
 const background=text('background.js');
 assert.match(background,/const DB_NAME='loc-web-capture-v2'/);
 assert.match(background,/const STORE='events'/);
 assert.match(background,/AUTO_CAPTURE_COUNT=10/);
 assert.match(background,/MAX_BYTES=600000/);
 assert.match(background,/__locGalaxyLinkImport/);
 assert.match(background,/world:'MAIN'/);
 assert.match(background,/locImportPaused/);
 assert.match(background,/ACK_STORE='acknowledged'/);
 assert.match(background,/indexedDB\.open\(DB_NAME,2\)/);
 assert.doesNotMatch(background,/launchWebAuthFlow|getToken\(|refresh_token|access_token|locOAuth|loc-mcp|mcp\.lo3rwang\.cc/);
});

test('recording uses explicit user selection and only observes selected visible DOM',()=>{
 const source=text('content.js');
 assert.match(source,/pick-record/);
 assert.match(source,/MutationObserver/);
 assert.match(source,/msg\.type==='page\.pause'/);
 assert.match(source,/msg\.type==='page\.resume'/);
 assert.match(source,/window\.removeEventListener\('scroll',scan\)/);
 assert.match(source,/IntersectionObserver/);
 assert.match(source,/state\.observer\?\.disconnect\(\)/);
 assert.match(source,/new Readability\(document\.cloneNode\(true\)\)/);
});

function isolatedBackground(){
 const listeners={};
 const on=name=>({addListener:fn=>{listeners[name]=fn;}});
 const chrome={
  runtime:{id:'test-extension',onInstalled:on('installed'),onMessage:on('message')},
  contextMenus:{onClicked:on('menu')},
  storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},
  tabs:{query:async()=>[]}
 };
 const context=createContext({chrome,crypto:webcrypto,TextEncoder,URL,console,Promise,Date,Uint8Array,Set,Map});
 runInContext(text('background.js'),context,{filename:'background.js'});
 return {context,listeners};
}

test('source URL and event UID remain stable on retry; a source becomes one article',async()=>{
 const {context}=isolatedBackground();
 const first=await runInContext("toEvents([{key:'post',url:'https://example.org/p/1?utm_source=x',source_key:'https://example.org/p/1?utm_source=x',title:'A',content:'body'}])",context);
 const second=await runInContext("toEvents([{key:'post',url:'https://example.org/p/1?utm_source=x',source_key:'https://example.org/p/1?utm_source=x',title:'A',content:'body'}])",context);
 assert.equal(first.length,1);
 assert.equal(first[0].id,second[0].id);
 assert.equal(first[0].group_id,second[0].group_id);
 assert.equal(first[0].source_key,'https://example.org/p/1');
 assert.equal(first[0].write_mode,'append');
 assert.equal(first[0].part_index,0);
 assert.equal(first[0].part_count,1);
 assert.match(first[0].id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('queue threshold is 10 captures or 600 KB, not each individual request',()=>{
 const {context}=isolatedBackground();
 assert.equal(runInContext("ready([])",context),0);
 assert.equal(runInContext("ready(Array.from({length:9},(_,i)=>({group_id:String(i),content:'x'})))",context),false);
 assert.equal(runInContext("ready(Array.from({length:10},(_,i)=>({group_id:String(i),content:'x'})))",context),true);
 assert.equal(runInContext("ready([{group_id:'g',content:'x'.repeat(600000)}])",context),true);
});

test('batch split never combines more than 50 or 590 KB of event data',()=>{
 const {context}=isolatedBackground();
 const counts=runInContext("packet(Array.from({length:103},(_,i)=>({id:'item'+i,content:'x'.repeat(300)}))).map(b=>b.length)",context);
 assert.deepEqual(Array.from(counts),[50,50,3]);
});

test('background rejects cross-origin injection before any Queue write',async()=>{
 const {listeners}=isolatedBackground();
 let result=null;
 listeners.message({type:'items.captured',items:[
  {url:'https://example.org/post/1',source_key:'https://example.org/post/1',content:'OK'},
  {url:'https://attacker.invalid/post/2',source_key:'https://attacker.invalid/post/2',content:'attack'}]},
 {id:'test-extension',tab:{url:'https://example.org/post/1'}},x=>{result=x;});
 for(let i=0;i<20&&result===null;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.match(result?.error||'',/Source origin mismatch/);
});

test('existing website gateway requests a signed write delegation, not manage, for short imports',()=>{
 const gateway=readFileSync(join(root,'../../app/loc/providers/loc-gateway.mjs'),'utf8');
 const edge=readFileSync(join(root,'../../app/loc/providers/kysely-edge.mjs'),'utf8');
 const page=readFileSync(join(root,'../../app/extension/bridge/GalaxyLinkBridge.jsx'),'utf8');
 assert.match(gateway,/kind==='short-import'/);
 assert.match(gateway,/actions:\['write'\]/);
 assert.match(edge,/shortImport\(scopeid,batch\)/);
 assert.match(page,/dbAuthClient\.shortImport\(scope,batch\)/);
 assert.match(page,/__locGalaxyLinkImport/);
});

test('website signed delegation reaches short-import gateway without extra target or a second login',async()=>{
 let siteAccessChecks=0,authorityCalls=0,edgeCalls=0,issued=null,sent=null;
 const batch={id:'00000000-0000-4000-8000-000000000001',write_mode:'append',records:[]};
 const gateway=createLocGatewayAdapter({
  authorityUrl:'https://auth.loc.test',
  gatewayUrl:'https://sql.loc.test/kysely',
  accountAdapter:{
   auth:{},
   getAccessToken:async()=>{siteAccessChecks++;return 'existing-website-session-token'}
  },
  fetchImpl:async(url,options)=>{
   if(String(url).includes('/v1/delegation')){
    authorityCalls++;
    issued=JSON.parse(options.body);
    return {ok:true,status:200,json:async()=>({
     access_token:'signed.loc.delegation',expires_at:Math.ceil(Date.now()/1000)+300
    })};
   }
   edgeCalls++;
   sent=JSON.parse(options.body);
   assert.equal(options.headers.authorization,'Bearer signed.loc.delegation');
   return {ok:true,status:200,json:async()=>({
    accepted:true,id:batch.id,articles:[]
   })};
  }
 });
 const response=await gateway.authClient.shortImport('lo3rwang',batch);
 assert.equal(response.accepted,true);
 assert.deepEqual(issued,{audience:'sql',scopeid:'lo3rwang',actions:['write']});
 assert.deepEqual(Object.keys(sent).sort(),['batch','kind','scopeid']);
 assert.equal(sent.target,undefined);
 assert.equal(sent.scopeid,'lo3rwang');
 assert.equal(siteAccessChecks,1);
 assert.equal(authorityCalls,1);
 assert.equal(edgeCalls,1);
});
