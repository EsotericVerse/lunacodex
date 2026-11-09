import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script,createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
const root=join(dirname(fileURLToPath(import.meta.url)),'../extensions/loc-galaxy-link');
const text=name=>readFileSync(join(root,name),'utf8');
const manifest=JSON.parse(text('manifest.json'));

test('single LOC galaxy-link extension owns OAuth and all capture modes',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.equal(manifest.background.service_worker,'background.js');
 assert.equal(manifest.name,'LOC galaxy-link｜LOC 彩虹橋');
 assert.equal(manifest.action.default_popup,'popup.html');
 assert.ok(manifest.permissions.includes('identity'));
 assert.ok(manifest.permissions.includes('tabs'));
 assert.ok(manifest.host_permissions.includes('https://auth.lo3rwang.cc/*'));
});

test('extension scripts and vendored Readability compile',()=>{
 for(const name of ['background.js','content.js','popup.js','vendor/Readability.js'])
  assert.doesNotThrow(()=>new Script(text(name),{filename:name}));
});

test('one upgraded durable Queue and native LOC OAuth without website bridge',()=>{
 const bg=text('background.js');
 assert.match(bg,/const DB_NAME='loc-channel1-queue'/);
 assert.match(bg,/const STORE='pending',ACK_STORE='acknowledged'/);
 assert.match(bg,/AUTO_CAPTURE_COUNT=10/);
 assert.match(bg,/MAX_BYTES=600000/);
 assert.match(bg,/indexedDB\.open\(DB_NAME,2\)/);
 assert.match(bg,/chrome\.identity\.launchWebAuthFlow/);
 assert.match(bg,/supports_scope_routing/);
 assert.match(bg,/sendViaAuth\(/);
 assert.doesNotMatch(bg,/__locGalaxyLinkImport|LOC_BRIDGE/);
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
  runtime:{id:'test-extension',onInstalled:on('installed'),onMessage:on('message'),openOptionsPage:async()=>{}},
  contextMenus:{onClicked:on('menu')},alarms:{onAlarm:on('alarm')},action:{setBadgeText:async()=>{}},
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

test('identical capture to different galaxies is not suppressed by acknowledgements',async()=>{
 const {context}=isolatedBackground();
 const input="[{key:'same-post',url:'https://example.org/p/1',source_key:'https://example.org/p/1',title:'Post',content:'same words'}]";
 const a=await runInContext("toEvents("+input+",'lo3rwang')",context);
 const b=await runInContext("toEvents("+input+",'lrunes')",context);
 const c=await runInContext("toEvents("+input+",'newscope')",context);
 assert.equal(a[0].scopeid,'lo3rwang');
 assert.equal(b[0].scopeid,'lrunes');
 assert.equal(c[0].scopeid,'newscope');
 assert.notEqual(a[0].id,b[0].id);
 assert.notEqual(a[0].group_id,b[0].group_id);
 const background=text('background.js');
 assert.match(background,/rows\.filter\(r=>\(r\.scopeid\|\|'lo3rwang'\)===scopeid\)/);
 assert.match(background,/records:batchRows\.map\(\(\{scopeid:localScope,\.\.\.record\}\)=>record\)/);
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

test('canonical Threads and Instagram permalink aliases are accepted without cross-site capture',()=>{
 const {context}=isolatedBackground();
 const allowed=[
  ['https://www.threads.com/@writer/post/1','https://www.threads.net/@writer/post/1'],
  ['https://threads.net/@writer','https://threads.com/@writer/post/2'],
  ['https://www.instagram.com/','https://instagram.com/p/abc'],
  ['https://m.instagram.com/','https://www.instagram.com/p/abc'],
  ['https://example.org/read','https://example.org/post/1']
 ];
 const forbidden=[
  ['https://www.threads.com/@writer','https://attacker.example/post/1'],
  ['https://www.threads.com/@writer','https://evilthreads.com/post/1'],
  ['https://www.threads.net/@writer','https://login.threads.net/post/1'],
  ['https://www.threads.com/@writer','http://www.threads.net/post/1'],
  ['https://www.instagram.com/','https://www.threads.com/@writer/post/1'],
  ['https://example.org/','https://other.example.org/']
 ];
 for(const [page,source] of allowed)
  assert.equal(runInContext('captureSourceMatches('+JSON.stringify(page)+','+JSON.stringify(source)+')',context),true,page+' -> '+source);
 for(const [page,source] of forbidden)
  assert.equal(runInContext('captureSourceMatches('+JSON.stringify(page)+','+JSON.stringify(source)+')',context),false,page+' -> '+source);
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

class FakeElement{
 constructor(text='',tagName='DIV',role='',href=''){
  this.innerText=text;this.textContent=text;this.tagName=tagName;
  this.role=role;this.href=href;this.children=[];this.parentElement=null;
 }
 getClientRects(){return [1]}
 getBoundingClientRect(){return {top:10,bottom:100,left:0,width:200,height:90}}
 closest(q){return q.includes('article')&&this.parentElement?.tagName==='ARTICLE'?this.parentElement:null}
 matches(q){return q==='[data-message-author-role]'&&Boolean(this.role)}
 getAttribute(key){return key==='data-message-author-role'?this.role:null}
 querySelector(){return null}
 querySelectorAll(selector){
  if(selector.startsWith('[data-message-id]'))return this.children.filter(x=>x.role);
  if(selector.startsWith('article,'))return this.children.filter(x=>x.tagName==='ARTICLE');
  if(selector==='a[href]')return this.tagName==='ARTICLE'?
   this.children.filter(x=>x.tagName==='A'):
   this.children.flatMap(x=>x.querySelectorAll(selector));
  return [];
 }
}
function contentFixture({href,feed}){
 let handler=null;
 const url=new URL(href);
 const document={
  title:'Captured browser document',body:feed,
  addEventListener(){},removeEventListener(){}
 };
 const chrome={runtime:{onMessage:{addListener(fn){handler=fn;}}}};
 const context=createContext({
  chrome,document,location:{href:url.href,hostname:url.hostname},
  Element:FakeElement,URL,Readability:null,
  window:{addEventListener(){},removeEventListener(){}},
  innerHeight:900,globalThis:{},
  getComputedStyle:()=>({display:'block',visibility:'visible'}),
  MutationObserver:class{},IntersectionObserver:class{},
 });
 runInContext(text('content.js'),context,{filename:'content.js'});
 return payload=>{
  let response=null;
  handler({type:'page.capture',...payload},null,result=>{response=result});
  return response?.items||[];
 };
}
test('Threads feed records distinct permalink articles, not a single merged profile',()=>{
 const feed=new FakeElement('','MAIN');
 for(const [id,body] of [
  ['123','First Threads post with more than 25 characters'],
  ['456','Second Threads post with more than 25 characters']
 ]){
  const post=new FakeElement(body,'ARTICLE');
  const link=new FakeElement('permalink','A','',
   'https://www.threads.net/@alex/post/'+id);
  link.parentElement=post;post.children=[link];feed.children.push(post);
 }
 const items=contentFixture({href:'https://www.threads.net/@alex',feed})();
 assert.equal(items.length,2);
 assert.equal(new Set(items.map(x=>x.source_key)).size,2);
 assert.ok(items.every(x=>x.source_key.includes('/post/')));
});

test('history capture includes full original user text and AI text only when opted in',()=>{
 const feed=new FakeElement();
 const user=new FakeElement('The complete original user message','DIV','user');
 const ai=new FakeElement('Assistant response available only by choice','DIV','assistant');
 feed.children=[user,ai];
 const capture=contentFixture({href:'https://chatgpt.com/c/example',feed});
 const defaultItems=capture();
 const withAssistant=capture({includeAssistant:true});
 assert.equal(defaultItems.length,1);
 assert.match(defaultItems[0].content,/complete original user message/);
 assert.equal(withAssistant.length,2);
 assert.ok(withAssistant.some(x=>x.content.startsWith('[assistant]')));
});
