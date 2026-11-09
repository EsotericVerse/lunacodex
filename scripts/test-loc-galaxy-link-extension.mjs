import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Script,createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const base='extensions/loc-galaxy-link/';
const bg=read(base+'background.js');
const content=read(base+'content.js');
const manifest=JSON.parse(read(base+'manifest.json'));
test('only one named galaxy-link extension with all right-click actions',()=>{
 assert.equal(manifest.name,'LOC galaxy-link｜LOC 彩虹橋');
 assert.equal(manifest.version,'0.2.4');
 assert.equal(Object.hasOwn(manifest.action,'default_popup'),false);
 assert.equal(manifest.background.service_worker,'background.js');
 assert.ok(manifest.permissions.includes('identity'));
 assert.ok(manifest.permissions.includes('contextMenus'));
 assert.ok(manifest.permissions.includes('tabs'));
 for(const menu of ['MENU_PAGE','MENU_SELECTION','MENU_AREA','MENU_RECORD','MENU_PAUSE','MENU_RESUME','MENU_STOP'])assert.ok(bg.includes(menu));
 assert.equal(existsSync(new URL('../extensions/loc-web-capture-v2/',import.meta.url)),false);
});
test('all extension scripts compile and Readability library is included',()=>{
 for(const script of ['background.js','content.js','options.js','vendor/Readability.js'])
  assert.doesNotThrow(()=>new Script(read(base+script),{filename:script}));
 assert.ok(existsSync(new URL('../'+base+'vendor/LICENSE.md',import.meta.url)));
});
test('single LOC Auth PKCE and durable Queue are shared across every capture mode',()=>{
 assert.match(bg,/const DB_NAME='loc-channel1-queue'/);
 assert.match(bg,/const STORE='pending',ACK_STORE='acknowledged'/);
 assert.match(bg,/indexedDB\.open\(DB_NAME,2\)/);
 assert.match(bg,/chrome\.identity\.launchWebAuthFlow/);
 assert.match(bg,/code_challenge_method:'S256'/);
 assert.match(bg,/grant_type:'refresh_token'/);
 assert.match(bg,/validateArticleReceipts\(receipt\.articles,batch\.records\)/);
 assert.match(bg,/await removeEvents\(group\)/);
 assert.match(bg,/const scopeid of \[\.\.\.new Set\(rows\.map/);
 assert.match(bg,/records:group\.map\(\(\{scopeid:localScope,\.\.\.record\}\)/);
 assert.doesNotMatch(bg,/__locGalaxyLinkImport|loc-web-capture-v2|locTab|LOC_BRIDGE/);
});
test('loaded conversations, social posts, selected areas and live recording coexist',()=>{
 assert.match(content,/function conversationTurns\(/);
 assert.match(content,/chatgpt\\.com/);
 assert.match(content,/MutationObserver/);
 assert.match(content,/IntersectionObserver/);
 assert.match(content,/new Readability\(document\.cloneNode\(true\)\)/);
 assert.match(content,/msg\.type==='page\.pause'/);
 assert.match(content,/msg\.type==='page\.resume'/);
 assert.match(bg,/function captureSourceMatches\(/);
 assert.match(bg,/chrome\.scripting\.executeScript/);
 assert.match(bg,/function toEvents\(/);
 assert.match(bg,/sendViaAuth\(/);
});
test('a not-yet-upgraded LOC Auth never routes another Scope into default',()=>{
 const worker=read('workers/loc-authority/native-oauth.mjs');
 assert.match(worker,/requestedScope=new URL\(request\.url\)\.searchParams\.get\('scopeid'\)/);
 assert.match(worker,/loc_import_scope_routing:'query-v1'/);
 assert.match(bg,/scopeid!=='lo3rwang'&&config\.supports_scope_routing!==true/);
 assert.match(bg,/endpoint\.searchParams\.set\('scopeid',scopeid\)/);
});
test('same-origin and origin-bound capture plus UID receipts prevent data loss',()=>{
 assert.match(bg,/sender\.id!==chrome\.runtime\.id/);
 assert.match(bg,/captureSourceMatches\(sender\.tab\.url,item\?\.url\)/);
 assert.match(bg,/if\(!received\.has\(key\)\)throw contractError/);
 assert.match(bg,/await sendViaAuth\(scopeid,batch,token,settings\.locConfig\)/);
 assert.match(bg,/await removeEvents\(group\)/);
});

test('Chrome icon opens preferences; all capture commands stay in native right-click menu',()=>{
 assert.match(bg,/chrome\.action\.onClicked\.addListener\(\(\)=>chrome\.runtime\.openOptionsPage\(\)\)/);
 assert.match(bg,/chrome\.contextMenus\.onClicked\.addListener/);
 assert.match(bg,/parentId:MENU_ROOT/);
 assert.doesNotMatch(read(base+'options.html'),/id="capture"|id="record"|id="pause"|id="resume"|id="stop"/);
 assert.ok(!existsSync(new URL('../'+base+'popup.html',import.meta.url)));
 assert.ok(!existsSync(new URL('../'+base+'popup.js',import.meta.url)));
 assert.match(read(base+'options.html'),/網頁右鍵/);
 assert.match(read(base+'options.js'),/locTargetScope/);
 assert.match(read(base+'options.js'),/locIncludeAssistant/);
});

test('context menu options are contextual, never all active together',()=>{
 assert.match(bg,/chrome\.contextMenus\.onShown\?\.addListener/);
 assert.match(bg,/function menuVisibility\(mode='idle'\)/);
 assert.match(bg,/\[MENU_PAUSE\]:mode==='record'/);
 assert.match(bg,/\[MENU_RESUME\]:mode==='paused'/);
 assert.match(bg,/\[MENU_STOP\]:active/);
 assert.match(bg,/visible:menuVisibility\(\)\[id\]/);
});
test('badge comes only from pending Queue, errors have actionable diagnostics',()=>{
 assert.match(bg,/async function updateQueueBadge/);
 assert.match(bg,/captureTotals\(rows/);
 assert.doesNotMatch(bg,/setBadgeText\(\{text:'!'|setBadgeText\(\{text:'OK'/);
 assert.match(bg,/locLastAction:item/);
 assert.match(bg,/noteAction\(label,false/);
 assert.match(content,/msg\.type==='page\.feedback'/);
 assert.match(read(base+'options.html'),/id="lastAction"/);
});
test('conversation capture searches rendered turns by role and semantic labels, including selected main',()=>{
 assert.match(content,/function roleOf\(turn\)/);
 assert.match(content,/you said\|你說/);
 assert.match(content,/\[data-testid="user-message"\],\.whitespace-pre-wrap/);
 assert.match(content,/mode==='record'\|\|doc===document\.body/);
 assert.match(content,/const main=recording&&chat/);
 assert.match(content,/scope\.matches\?\.\(TURN_SELECTOR\)/);
});
test('recording failures and no-message state are never silently swallowed',()=>{
 assert.match(content,/reportCapture\('錄製已啟動/);
 assert.match(content,/錄製擷取失敗，Queue 未確認寫入/);
 assert.match(bg,/case 'capture\.report'/);
 assert.match(bg,/await noteAction\('動態擷取',false/);
 assert.doesNotMatch(content,/catch\s*\{\s*\/\/ Failure is not an acknowledgement/);
});
test('long ChatGPT conversation is split into 100-turn Queue messages; never dropped as a whole',()=>{
 assert.match(bg,/for\(let i=0;i<items.length;i\+=100\)/);
 assert.match(content,/for\(let offset=0;offset<pending.length;offset\+=100\)/);
 assert.match(content,/const outstanding=\[\.\.\.state\.pendingWrites\]/);
 assert.match(content,/await Promise\.all\(outstanding\)/);
 assert.match(content,/node\.closest\?\.\('\[data-testid\^="conversation-turn-"\]'\)/);
});
test('HTTP backend errors are visible with redaction and exponential backoff',()=>{
 assert.match(bg,/後端未提供可讀取的錯誤說明/);
 assert.match(bg,/locQueueFailures:failures/);
 assert.match(bg,/locQueueRetryType:'server'/);
 assert.match(bg,/e\.httpStatus=reply\.status/);
 assert.match(bg,/if\(reply\?\.error\)throw Error\('最後一次錄製入列失敗/);
 assert.match(read(base+'options.js'),/result\.nextRetryAt>Date\.now\(\)/);
});


function runtimeCaptureHarness(){
 const state={locImportPaused:true,locTargetScope:'lo3rwang',
  locConfig:{import_url:'https://auth.lo3rwang.cc/v1/import/short',
   supports_scope_routing:false}};
 const saved=[],removed=[],requestLog=[];
 let responder=async()=>Response.json({error:'service unavailable'},{status:500});
 const on=()=>({addListener(){}});
 const chrome={
  runtime:{id:'loc-test',onInstalled:on(),onStartup:on(),onMessage:on(),
   openOptionsPage:async()=>{}},
  contextMenus:{onShown:on(),onClicked:on()},action:{onClicked:on(),
   setBadgeText:async()=>{},setTitle:async()=>{}},
  alarms:{onAlarm:on()},tabs:{query:async()=>[],sendMessage:async()=>{}},
  storage:{local:{
   get:async()=>({...state}),
   set:async v=>{Object.assign(state,v)},
   remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])
    delete state[key]}
  }}
 };
 const ctx=createContext({chrome,crypto:webcrypto,TextEncoder,URL,URLSearchParams,
  Response,Date,console,Promise,Array,Uint8Array,Set,Map,btoa,fetch:async(url,opts)=>{
   requestLog.push({url,opts});return responder(url,opts);
  }});
 runInContext(bg,ctx,{filename:'background.js'});
 // Exercise real batching/UID/HTTP logic; replace only IndexedDB and OAuth.
 ctx.saved=saved;ctx.removed=removed;
 runInContext(
  'putEvents=async events=>{saved.push(...events);return events.length};'+
  'allEvents=async()=>saved;'+
  'queueCount=async()=>saved.length;'+
  'updateQueueBadge=async()=>({});'+
  "activeToken=async()=> 'test-token-only';"+
  'removeEvents=async rows=>{removed.push(...rows);'+
   'for(const row of rows){const i=saved.findIndex(x=>x.id===row.id);'+
   'if(i>=0)saved.splice(i,1)}};',
  ctx);
 return {state,saved,removed,requestLog,api:name=>runInContext(name,ctx),
  respond:fn=>{responder=fn}};
}
test('runtime: 205-turn loaded conversation enters Queue without >100 rejection',async()=>{
 const h=runtimeCaptureHarness();
 const input=Array.from({length:205},(_,i)=>({
  key:'turn-'+i,title:'Chat',url:'https://chatgpt.com/c/history',
  source_key:'https://chatgpt.com/c/history',content:'[user]\nMessage '+i
 }));
 const reply=await h.api('acceptItems')(input);
 assert.equal(reply.queued,205);
 assert.equal(h.saved.length,205);
 assert.equal(h.requestLog.length,0);
});
test('runtime: HTTP 500 keeps all Queue items and backs off safely',async()=>{
 const h=runtimeCaptureHarness();
 const source='https://chatgpt.com/c/queue';
 await h.api('acceptItems')([{key:'turn',title:'Chat',url:source,
  source_key:source,content:'[user]\nKeep original conversation'}]);
 h.state.locImportPaused=false;
 h.respond(async()=>Response.json({error:
  'Missing SQL target password=private postgresql://user:private@db.example/loc'},
  {status:500}));
 await assert.rejects(h.api('flush')(true),e=>
  e.httpStatus===500&&/Missing SQL target/.test(e.message)&&
  !e.message.includes('password=private')&&
  !e.message.includes('postgresql://'));
 assert.equal(h.saved.length,1);
 assert.equal(h.removed.length,0);
 assert.equal(h.state.locQueueRetryType,'server');
 assert.ok(h.state.locQueueRetryAfter>Date.now());
});
test('runtime: only fully confirmed UID receipt deletes a Queue record',async()=>{
 const h=runtimeCaptureHarness();
 const source='https://chatgpt.com/c/uid';
 await h.api('acceptItems')([{key:'turn',title:'Chat',url:source,
  source_key:source,content:'[user]\nPersist after confirmed UID'}]);
 h.state.locImportPaused=false;
 h.respond(async(_url,opts)=>{
  const batch=JSON.parse(opts.body);
  return Response.json({accepted:true,id:batch.id,
   articles:[{source_key:source,uid:'ABCDEFGH'}]});
 });
 const done=await h.api('flush')(true);
 assert.equal(done.sent,1);
 assert.equal(h.saved.length,0);
 assert.equal(h.removed.length,1);
 assert.equal(h.state.locQueueFailures,undefined);
});
test('runtime: 429 rate limit blocks manual retry as well',async()=>{
 const h=runtimeCaptureHarness();
 const source='https://chatgpt.com/c/ratelimit';
 await h.api('acceptItems')([{key:'turn',url:source,source_key:source,
  title:'Chat',content:'[user]\nRetain me'}]);
 h.state.locImportPaused=false;
 h.state.locQueueRetryAfter=Date.now()+120000;
 h.state.locQueueRetryType='rate';
 const result=await h.api('flush')(true);
 assert.equal(result.sent,0);
 assert.equal(h.requestLog.length,0);
 assert.equal(h.saved.length,1);
});


test('runtime: ChatGPT DOM captures one turn at a time and never treats AI as user',()=>{
 const helper=content.slice(content.indexOf('  const TURN_SELECTOR='),
  content.indexOf('  function extract('));
 const createTurn=(role,index,headings=false)=>{
  const body={innerText:role+' content',querySelectorAll:()=>[],
   getAttribute:key=>key==='data-testid'?role+'-message':null};
  const turn={innerText:'toolbar should not be archived',
   getAttribute:key=>key==='data-testid'?'conversation-turn-'+index:null,
   matches:()=>true,closest:()=>turn,
   querySelector:selector=>!headings&&selector.includes(role+'-message')?body:null,
   querySelectorAll:selector=>selector.includes('h5,h6,')&&headings?
    [{textContent:role==='user'?'You said':'ChatGPT said'}]:[]};
  return turn;
 };
 const user=createTurn('user',0),assistant=createTurn('assistant',1);
 const document={body:{},querySelector:()=>null};
 const location={hostname:'chatgpt.com',href:'https://chatgpt.com/c/test'};
 const api=new Function('location','document','normalizeUrl','cleanText','visible','links',
  helper+'return {roleOf,conversationTurns};')(
   location,document,x=>x,node=>node?.innerText||'',()=>true,()=>[]);
 const main={matches:()=>false,closest:()=>null,
  querySelectorAll:()=>[user,assistant]};
 const users=api.conversationTurns(main,false);
 assert.equal(users.length,1);
 assert.match(users[0].content,/^\[user\]\nuser content/);
 assert.doesNotMatch(users[0].content,/toolbar|assistant content/);
 const both=api.conversationTurns(main,true);
 assert.equal(both.length,2);
 assert.match(both[1].content,/^\[assistant\]\nassistant content/);
 assert.equal(api.roleOf(createTurn('user',2,true)),'user');
 assert.equal(api.roleOf(createTurn('assistant',3,true)),'assistant');
});
