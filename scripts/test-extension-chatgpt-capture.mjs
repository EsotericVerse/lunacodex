// Focused DOM-contract regression for ChatGPT whole-page capture.
// Run manually: node scripts/test-extension-chatgpt-capture.mjs
// This script is not part of prebuild/prepare and cannot trigger deployment.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const directory=new URL('../extensions/loc-galaxy-link/',import.meta.url);
const vendor=readFileSync(new URL('vendor/ChatGPTShadowExtract.js',directory),'utf8');
const bridge=readFileSync(new URL('content.js',directory),'utf8');
const url='https://chatgpt.com/c/6af8ff99-6b54-83ee-8ee5-06f99616d940';
let listener,streaming=false;
function message(type,role,body,id,nested=[]){
  const attrs=type==='legacy'
    ?{'data-message-author-role':role,'data-message-id':id}
    :{'data-chatgpt-search-unit-key':'fallback-turn-1:2:'+role,
      'data-chatgpt-selection-message-id':id};
  return {type,innerText:body,parentElement:null,
    getAttribute:key=>attrs[key]||'',
    querySelector:()=>null,
    querySelectorAll:selector=>selector==='[data-chatgpt-search-unit-key]'?nested:[],
    closest:()=>null};
}
function conversation(nodes){
  const legacy=nodes.filter(x=>x.type==='legacy');
  const units=nodes.filter(x=>x.type==='unit');
  return {closest:()=>null,querySelector:()=>null,
    querySelectorAll(selector){
      if(selector==='[data-message-author-role]')return legacy;
      if(selector==='[data-chatgpt-search-unit-key]')return units;
      if(selector==='[data-message-author-role],[data-chatgpt-search-unit-key]')
        return nodes;
      return [];
    }};
}
const doc={title:'Complete chat - ChatGPT',body:conversation([]),
  querySelector(selector){
    if(selector==='main')return this.body;
    return streaming&&selector==='[data-testid="stop-button"]'
      ?{getClientRects:()=>[{}],getAttribute:()=>''}:null;
  },
  querySelectorAll:()=>[],addEventListener:()=>{},removeEventListener:()=>{}};
const context=vm.createContext({
  document:doc,location:{href:url,hostname:'chatgpt.com'},URL,
  MutationObserver:class{observe(){} disconnect(){}},
  IntersectionObserver:class{observe(){} disconnect(){}},
  window:{addEventListener(){},removeEventListener(){}},
  setTimeout:()=>1,clearTimeout:()=>{},
  chrome:{runtime:{onMessage:{addListener(fn){listener=fn}},
    sendMessage:async()=>({queued:0})}}});
vm.runInContext(vendor,context,{filename:'ChatGPTShadowExtract.js'});
vm.runInContext(bridge,context,{filename:'content.js'});
assert.equal(typeof listener,'function');
function capture(nodes,includeAssistant=true){
  doc.body=conversation(nodes);
  let reply;
  listener({type:'page.capture',selection:'',includeAssistant},null,value=>{reply=value});
  assert.ok(reply,'capture must reply synchronously');
  return reply;
}
let count=0;
function check(name,nodes,includeAssistant,expectedRoles){
  streaming=false;
  const reply=capture(nodes,includeAssistant);
  assert.equal(reply.error,undefined,name+': '+reply.error);
  assert.deepEqual(Array.from(reply.items, x=>x.content.match(/^\[(user|assistant)\]/)[1]),
    expectedRoles,name);
  count++;
}
const legacyUser=message('legacy','user','My question','old-u');
const legacyAssistant=message('legacy','assistant','Earlier reply','old-a');
const modernUser=message('unit','user','My question','new-u');
const modernAssistant=message('unit','assistant','AI response','new-a');
check('legacy-only',[legacyUser,legacyAssistant],true,['user','assistant']);
check('modern-only',[modernUser,modernAssistant],true,['user','assistant']);
check('mixed message layouts',[legacyUser,modernAssistant],true,['user','assistant']);
check('AI option disabled',[legacyUser,modernAssistant],false,['user']);
check('duplicate ID dedupe',[legacyUser,
  message('unit','user','My question','old-u'),modernAssistant],
  true,['user','assistant']);
check('mixed nested roles',[message('legacy','user','My question','nested-u',[modernAssistant]),
  modernAssistant],true,['user','assistant']);
const missing=capture([legacyUser],true);
assert.match(missing.error||'',/無法辨識任何 AI 回覆/);count++;
streaming=true;
const unsettled=capture([legacyUser,legacyAssistant,modernAssistant],true);
assert.equal(unsettled.error,undefined);
assert.deepEqual(Array.from(unsettled.items,x=>x.content.match(/^\\[(user|assistant)\\]/)[1]),
  ['user','assistant']);count++;
streaming=false;
// Recording starts immediately on ChatGPT, without requiring an area click.
let started;
listener({type:'page.record',includeAssistant:true},null,value=>{started=value});
assert.equal(started?.ok,true);
assert.equal(started?.mode,'record');count++;
let finished;
listener({type:'page.stop'},null,value=>{finished=value});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(finished?.ok,true);count++;
console.log('ChatGPT capture contract: '+count+' cases PASS');
