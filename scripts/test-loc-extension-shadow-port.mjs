import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext,Script} from 'node:vm';

const read=path=>readFileSync(new URL('../extensions/loc-galaxy-link/'+path,import.meta.url),'utf8');
const vendor=read('vendor/ChatGPTShadowExtract.js');
const content=read('content.js');
const background=read('background.js');
const thread='11111111-1111-4111-8111-111111111111';
const another='22222222-2222-4222-8222-222222222222';
const href='https://chatgpt.com/c/'+thread;

function makeNode(role,text,id,conversationId=thread){
 const el={nodeType:1,tagName:'ARTICLE',innerText:text,textContent:text};
 el.attrs={'data-message-author-role':role,'data-message-id':id,
   'data-chatgpt-selection-conversation-id':conversationId};
 el.getAttribute=name=>el.attrs[name]||null;
 el.querySelector=selector=>selector.includes('.whitespace-pre-wrap')
   ?{innerText:text,textContent:text}:null;
 el.querySelectorAll=()=>[];
 return el;
}
function fixture({streaming=false,messages=[
 makeNode('user','Visible user text','message-user'),
 makeNode('assistant','Assistant reply','message-assistant')
]}={}){
 const page={title:'Example - ChatGPT',ownerDocument:null,body:null};
 const main={querySelector:()=>null,closest:()=>main,querySelectorAll:selector=>
   selector==='[data-message-author-role]'?messages:[],
   ownerDocument:page};
 page.querySelector=selector=>streaming&&selector==='[data-testid="stop-button"]'?{}:null;
 page.querySelectorAll=selector=>
   selector==='[data-talvt-turn-state]'?[]:main.querySelectorAll(selector);
 page.body=main;
 return {page,main};
}
function extractor(){
 const context=createContext({globalThis:{}});
 new Script(vendor,{filename:'ChatGPTShadowExtract.js'}).runInContext(context);
 const first=context.globalThis.ChatGPTShadowExtract;
 assert.equal(typeof first.extractMessages,'function');
 // LOC inject() may run more than once on the same tab.
 new Script(vendor,{filename:'ChatGPTShadowExtract.js'}).runInContext(context);
 assert.equal(typeof context.globalThis.ChatGPTShadowExtract.extractMessages,'function');
 return first;
}
function locAdapter(upstream,page,main,url=href){
 const adapterSource=content.slice(content.indexOf('  function shadowConversationTurns('),
   content.indexOf('  function roleOf('));
 const extractSource=content.slice(content.indexOf('  function extract('),
   content.indexOf('  function fingerprint('));
 assert.ok(adapterSource.includes('upstream.extractMessages(scope)'));
 assert.ok(extractSource.includes('return shadowConversationTurns(region,includeAssistant)'));
 const globals=createContext({
   globalThis:{ChatGPTShadowExtract:upstream},document:page,
   location:{hostname:'chatgpt.com',href:url},
   state:{includeAssistant:false},CHAT_HOST:/(?:^|\.)chatgpt\.com$|(?:^|\.)chat\.openai\.com$/,
   normalizeUrl:value=>value,conversationTurns:()=>{throw Error('Legacy ChatGPT path executed');}
 });
 new Script(adapterSource+'\n'+extractSource,{filename:'LOC ChatGPT port'}).runInContext(globals);
 return globals.extract;
}

test('full Apache-2.0 extractor is bundled before LOC content script',()=>{
 assert.match(vendor,/ChatGPTShadowExtract =/);
 assert.match(background,/'vendor\/ChatGPTShadowExtract\.js','content\.js'/);
 assert.match(read('vendor/ChatGPT-Shadow-LICENSE.txt'),/Apache License/);
 assert.doesNotThrow(()=>new Script(vendor,{filename:'ChatGPTShadowExtract.js'}));
});
test('ported ChatGPT DOM extractor reads both roles with stable message IDs',()=>{
 const upstream=extractor();
 const {page,main}=fixture();
 const rows=upstream.extractMessages(main);
 assert.deepEqual(Array.from(rows.map(x=>x.role)),['user','assistant']);
 assert.equal(rows[0].id,'message-user');
 assert.equal(rows[1].content,'Assistant reply');
 assert.equal(upstream.stableMessageId(thread,rows[0]),'message-user');
 assert.equal(upstream.extractTitle(page),'Example');
});
test('ported DOM filter rejects previous conversation after SPA navigation',()=>{
 const upstream=extractor();
 const {main}=fixture({messages:[makeNode('user','OLD','msg-old',another)]});
 const rows=upstream.messagesForUrl(upstream.extractMessages(main),href);
 assert.equal(rows.length,0);
});
test('LOC port keeps capture opt-in and skips streaming assistant replies',()=>{
 const upstream=extractor();
 const {page,main}=fixture({streaming:true});
 const extract=locAdapter(upstream,page,main);
 const userOnly=extract(main,'record',false);
 assert.equal(userOnly.length,1);
 assert.equal(userOnly[0].key,'message-user');
 assert.equal(userOnly[0].source_key,href);
 assert.equal(userOnly[0].content,'[user]\nVisible user text');
 assert.equal(extract(main,'record',true).length,1,
   'Do not persist a partial assistant message while generating');
 page.querySelector=()=>null;
 const both=extract(main,'capture',true);
 assert.equal(both.length,2);
 assert.equal(both[1].content,'[assistant]\nAssistant reply');
});
test('LOC port refuses placeholder URLs until the saved conversation ID exists',()=>{
 const upstream=extractor();
 const {page,main}=fixture();
 const extract=locAdapter(upstream,page,main,'https://chatgpt.com/c/local-chatgpt:1234');
 assert.equal(extract(main,'record',true).length,0);
});
test('2026 search-unit markup is recognized and preserves markdown',()=>{
 const upstream=extractor();
 const strong={nodeType:1,tagName:'STRONG',childNodes:[
   {nodeType:3,textContent:'important'}],getAttribute:()=>null};
 const paragraph={nodeType:1,tagName:'P',childNodes:[
   {nodeType:3,textContent:'First '},strong],getAttribute:()=>null};
 const markdown={nodeType:1,tagName:'DIV',childNodes:[paragraph],
   getAttribute:()=>null};
 const user={
  nodeType:1,tagName:'DIV',innerText:'First user message',
  getAttribute:key=>key==='data-chatgpt-search-unit-key'?'fallback-turn-1:user':null,
  querySelector:s=>s==='[data-user-message-bubble]'?{
    querySelector:()=>null,innerText:'First user message'
  }:null,
  querySelectorAll:selector=>selector==='[data-markdown-text-style]'?[markdown]:[],
  parentElement:null
 };
 const {main}=fixture({messages:[]});
 main.querySelectorAll=selector=>selector==='[data-message-author-role]'?[]
   :selector==='[data-chatgpt-search-unit-key]'?[user]:[];
 const rows=upstream.extractMessages(main);
 assert.equal(rows.length,1);
 assert.equal(rows[0].role,'user');
 assert.equal(rows[0].content,'First **important**');
});
