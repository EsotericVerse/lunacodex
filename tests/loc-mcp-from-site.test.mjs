import test from 'node:test';
import assert from 'node:assert/strict';
import {siteForCapturedUrl,CAPTURE_FROM_SITES}
 from '../app/loc/source/site-from-url.mjs';
import {siteForShortImportSource,processShortImport}
 from '../app/loc/import/short-append-service.mjs';
import {executeLocConversation}
 from '../app/loc/mcp/conversations.mjs';
import {mergeOrdered} from '../app/loc/mcp/ordered-conversation.mjs';

test('MCP is only a Domain; five real From labels are authoritative',()=>{
 assert.deepEqual(CAPTURE_FROM_SITES,['web','Github','ChatGPT','Claude','Gemini']);
 const cases=[
  ['https://news.example.net/post','web'],
  ['https://github.com/EsotericVerse/lunarcus','Github'],
  ['https://gist.github.com/a/b','Github'],
  ['https://chatgpt.com/c/123','ChatGPT'],
  ['https://chat.openai.com/c/123','ChatGPT'],
  ['https://claude.ai/chat/123','Claude'],
  ['https://gemini.google.com/app/123','Gemini']
 ];
 for(const [url,site] of cases){
  assert.equal(siteForCapturedUrl(url),site);
  assert.equal(siteForShortImportSource(url),site);
 }
 assert.equal(siteForCapturedUrl('legacy-id'),'web');
 assert.ok(!CAPTURE_FROM_SITES.includes('mcp'));
});

const uuid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const url='https://chatgpt.com/c/abcd';
const event={id:uuid(1),group_id:uuid(2),source_key:url,url,
 write_mode:'append',kind:'capture',title:'Test conversation',content:'你好',
 captured_at:'2026-11-24T00:00:00.000Z',part_index:0,part_count:1};
const batch={id:uuid(3),write_mode:'append',records:[event]};
const actor={authorized:true,scopeid:'lo3rwang',subject:'verified-user'};
test('short import keeps the same UID and relabels legacy mcp even on retry',async()=>{
 const original={uid:'AABBCCDD',site:'mcp',site_id:'gl:legacy',
  content:'old content'};
 const calls=[];
 const store={transaction:async(_scope,run)=>run({
  lockSource:async()=>{},
  lookupMany:async ids=>[{...original,site_id:ids[0]}],
  relabelSource:async(uid,id,from,to)=>{
   calls.push(['relabel',uid,id,from,to]);original.site=to;
  },
  append:async(uid,id,tail)=>{
   calls.push(['append',uid,id]);original.content+='\n'+tail;
  },
  insertMany:async()=>{throw Error('duplicate source must not insert')}
 })};
 const result=await processShortImport(batch,actor,{store});
 assert.equal(result.accepted,true);
 assert.equal(result.articles[0].uid,'AABBCCDD');
 assert.equal(result.articles[0].appended,1);
 assert.equal(original.site,'ChatGPT');
 assert.equal(calls.filter(x=>x[0]==='relabel').length,1);
 const repeated=await processShortImport(batch,actor,{store});
 assert.equal(repeated.articles[0].appended,0);
 assert.equal(calls.filter(x=>x[0]==='relabel').length,1);
 assert.equal(calls.filter(x=>x[0]==='append').length,1);
});

const orderedA={message_id:'a',source_order:0,parent_id:null,role:'user',text:'開始'};
const orderedB={message_id:'b',source_order:1,parent_id:'a',role:'assistant',text:'回覆'};
const incoming={action:'record_ordered',scopeid:'lo3rwang',
 conversation_id:url,updated_at:'2026-11-24T00:00:00.000Z',
 records:[orderedA,orderedB]};
const claims={provider:'loc',me:true,grants:['lo3rwang:write']};
test('record_ordered creates a ChatGPT From row, never a site=mcp row',async()=>{
 let written;
 const db={
  selectFrom:()=>({
   select(){return this;},where(){return this;},orderBy(){return this;},
   limit(){return this;},async execute(){return [];}
  }),
  insertInto:()=>({
   values(row){written=row;return this;},async executeTakeFirst(){return {};}
  })
 };
 const receipt=await executeLocConversation(db,incoming,claims);
 assert.equal(receipt.accepted,true);
 assert.equal(receipt.count,2);
 assert.equal(written.site,'ChatGPT');
 assert.equal(written.site_id,url);
});
test('record_ordered duplicate relabels legacy source without changing UID or text',async()=>{
 const initial=mergeOrdered(null,[orderedA,orderedB]);
 const stored={uid:'ABCDEFGH',site:'mcp',site_id:url,
  title:'Original',content:initial.content,UpdateTime:'2026-11-23T00:00:00.000Z'};
 const db={
  selectFrom:()=>({
   select(){return this;},where(){return this;},orderBy(){return this;},
   limit(){return this;},async execute(){return [stored];}
  }),
  updateTable:()=>({
   set(update){this.update=update;return this;},
   where(){return this;},async executeTakeFirst(){
    assert.equal(Object.hasOwn(this.update,'content'),false);
    Object.assign(stored,this.update);
    return {numUpdatedRows:1};
   }
  })
 };
 const receipt=await executeLocConversation(db,incoming,claims);
 assert.equal(receipt.accepted,true);
 assert.equal(receipt.duplicate,true);
 assert.equal(receipt.count,0);
 assert.equal(receipt.uid,'ABCDEFGH');
 assert.equal(stored.site,'ChatGPT');
 assert.equal(stored.content,initial.content);
});
