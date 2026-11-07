import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace(/^import[\s\S]*?;\s*$/gm,'')
  .replace('export class LocAuthorityState','class LocAuthorityState')
  .replace('export default {','const worker={');
const {LocAuthorityState}=new Function('DurableObject',
  source+';return {LocAuthorityState};')(class{
    constructor(ctx,env){this.ctx=ctx;this.env=env;}
  });
const GATEWAY='https://sql.example.org/v1/sql';
const TOKEN='eyJ.mock.delegation';
const CONVERSATION={
  conversation_id:'chat-1',created_at:'2026-11-01T00:00:00Z',
  updated_at:'2026-11-01T01:00:00Z',title:'Test conversation',content:'Original user statement'
};
const PR_WARNING='請至github頁面找尋PR相關資料！不開放搜尋PR!';
function state(){
  const data=new Map();
  const storage={
    get:async key=>data.get(key),put:async(key,value)=>{data.set(key,value);},
    delete:async key=>{data.delete(key)},
    list:async({prefix})=>new Map([...data].filter(([key])=>key.startsWith(prefix)))
  };
  const env={LOC_MCP_SQL_GATEWAY_URL:GATEWAY};
  return {authority:new LocAuthorityState({storage},env),data};
}
function fakeSql(gatewayFn){
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body||'{}');
    const call={url:String(url),method:options.method,
      authorization:options.headers.authorization,body};
    calls.push(call);
    return gatewayFn?gatewayFn(call):Response.json({data:{count:1}});
  };
  return calls;
}
const originalFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=originalFetch});

test('Scope config accepts only trusted HTTPS Kysely Gateway, no API keys or arbitrary table',async()=>{
  const {authority,data}=state();
  const saved=await authority.putMcpScope('lrunes',{
    endpoint:GATEWAY,schema:'silver',table:'lrunes_galaxy'
  });
  assert.equal(saved.configured,true);
  assert.equal(saved.api_key,undefined);
  assert.equal((await authority.getMcpScope('lrunes')).endpoint,GATEWAY);
  assert.equal((await authority.mcpPrivateProfile('lrunes')).endpoint,GATEWAY);
  assert.ok(!JSON.stringify([...data]).includes('api_key'));
  for(const endpoint of ['https://db.example.org/rest/v1',
    'https://db.example.org/functions/v1/loc-kysely',
    'http://sql.example.org/v1/sql']){
    await assert.rejects(authority.putMcpScope('lrunes',{endpoint}),
      /Gateway|HTTPS|Data API/);
  }
  await assert.rejects(authority.putMcpScope('lrunes',{
    endpoint:GATEWAY,table:'someone_else_galaxy'
  }),/table must match/);
});

test('Built-in managed Scope publishes no vendor Data API or secret',async()=>{
  const {authority}=state();
  const entry=await authority.getMcpScope('lo3rwang');
  assert.equal(entry.configured,true);
  assert.equal(entry.managed,true);
  assert.equal(entry.provider,'loc-kysely');
  assert.equal(entry.table,'lo3rwang_galaxy');
  assert.equal(entry.api_key,undefined);
  assert.equal(entry.endpoint,undefined);
  assert.deepEqual(await authority.getMcpScope('thirdscope'),
    {scopeid:'thirdscope',configured:false});
});

test('First sync uses signed LOC Kysely Gateway with private flags; unchanged content never refetches',async()=>{
  const {authority}=state();
  const calls=fakeSql();
  const first=await authority.mcpSave('lo3rwang',CONVERSATION,TOKEN);
  const same=await authority.mcpSave('lo3rwang',CONVERSATION,TOKEN);
  assert.equal(first.saved,true);
  assert.equal(same.saved,false);
  assert.equal(first.uid.length,8);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,GATEWAY);
  assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].authorization,'Bearer '+TOKEN);
  assert.equal(calls[0].body.kind,'mcp-sync');
  assert.equal(calls[0].body.update_existing,false);
  assert.equal(calls[0].body.row.uid,first.uid);
  assert.equal(calls[0].body.row.site,'mcp');
  assert.equal(calls[0].body.row.site_id,'chat-1');
  for(const flag of ['culture','trace','search','statics','list','extract','others','keyword'])
    assert.equal(calls[0].body.row[flag],false,flag);
  assert.equal(Object.hasOwn(calls[0].body.row,'able'),false);
});

test('Failed Kysely save retries with the same UID without marking an unsaved checkpoint successful',async()=>{
  const {authority}=state();
  let attempt=0;
  const calls=fakeSql(()=>{
    attempt++;
    return attempt===1?Response.json({error:{message:'temporary'}},{status:503})
      :Response.json({data:{count:1}});
  });
  await assert.rejects(authority.mcpSave('lo3rwang',CONVERSATION,TOKEN));
  const checkpoint=await authority.mcpCheckpoint('lo3rwang','chat-1',CONVERSATION.updated_at);
  assert.equal(checkpoint.saved_at,null);
  assert.equal(checkpoint.needs_save,true);
  const saved=await authority.mcpSave('lo3rwang',CONVERSATION,TOKEN);
  assert.equal(saved.saved,true);
  assert.equal(calls.length,2);
  assert.equal(calls[0].body.row.uid,calls[1].body.row.uid);
  assert.equal(saved.uid,calls[0].body.row.uid);
  assert.equal(calls[1].body.update_existing,true);
});

test('100 concurrent saves of the same unchanged source issue one Kysely insert',async()=>{
  const {authority}=state();
  const calls=fakeSql();
  const responses=await Promise.all(Array.from({length:100},
    ()=>authority.mcpSave('lo3rwang',CONVERSATION,TOKEN)));
  assert.equal(responses.filter(item=>item.saved).length,1);
  assert.equal(calls.length,1);
});

test('Existing UID append remains idempotent after a lost Durable Object acknowledgment',async()=>{
  const {authority}=state();
  const batch='a'.repeat(64);
  const marker='[[GalaxyLinkBatch:'+batch+']]';
  const addition=marker+'\nA new correction after previous messages';
  const uid='Ab12Cd34',original='Original statement';
  let text=original;
  const calls=fakeSql(call=>{
    assert.equal(call.body.kind,'mcp-append');
    assert.equal(call.body.uid,uid);
    const duplicate=text.includes(marker);
    if(!duplicate)text+='\n'+call.body.content;
    return Response.json({data:{count:1,duplicate,title:'Conversation'}});
  });
  const input={conversation_id:'chat-append',uid,
    updated_at:'2026-11-05T01:00:00Z',title:'',
    content:addition,batch_id:batch,append:true};
  const first=await authority.mcpSave('lo3rwang',input,TOKEN);
  assert.equal(first.appended,true);
  assert.equal(text,original+'\n'+addition);
  await authority.ctx.storage.put('mcp-sync:lo3rwang:chat-append',
    {uid,updated_at:null,saved_at:null});
  const retried=await authority.mcpSave('lo3rwang',input,TOKEN);
  assert.equal(retried.saved,true);
  assert.equal(text,original+'\n'+addition);
  assert.equal(calls.length,2,'a retry rechecks the same batch at the Gateway');
  const unchanged=await authority.mcpSave('lo3rwang',input,TOKEN);
  assert.equal(unchanged.saved,false);
  assert.equal(calls.length,2);
});

test('Private reads and user-requested conversation search use the delegated gateway only',async()=>{
  const {authority}=state();
  const calls=fakeSql(call=>Response.json({data:call.body.kind==='mcp-search'
    ?[{uid:'Ab12Cd34',title:'Conversation',createtime:'2026-11-05T00:00:00Z'}]
    :[{uid:'Ab12Cd34',title:'Conversation',site:'mcp',content:'Only original user text'}]}));
  const results=await authority.mcpLinkSearch('lo3rwang','時間定錨',5,TOKEN);
  assert.equal(results.results[0].uid,'Ab12Cd34');
  const article=await authority.mcpRead('lo3rwang','Ab12Cd34',0,100,TOKEN);
  assert.equal(article.content,'Only original user text');
  assert.deepEqual(calls.map(x=>x.body.kind),['mcp-search','mcp-read']);
  assert.ok(calls.every(x=>x.url===GATEWAY&&x.authorization==='Bearer '+TOKEN));
  assert.equal(calls[0].body.scopeid,'lo3rwang');
  assert.equal(calls[0].body.query,'時間定錨');
  assert.equal(calls[1].body.uid,'Ab12Cd34');
  assert.equal(calls[1].body.site,'mcp');
});

test('Private reads and searches fail closed when LOC delegation is missing',async()=>{
  const {authority}=state();
  const calls=fakeSql(()=>{throw Error('Network must not be called')});
  await assert.rejects(authority.mcpRead('lo3rwang','Ab12Cd34',0,200),/delegation required/);
  await assert.rejects(authority.mcpLinkSearch('lo3rwang','時間定錨',5),/delegation required/);
  assert.equal(calls.length,0);
});

test('PR searches and PR updates are rejected before Kysely or Galaxy',async()=>{
  const {authority}=state();
  const calls=fakeSql(()=>{throw Error('Forbidden network access')});
  for(const query of ['PR #1190','PR1193','PR-1192','github commit']){
    await assert.rejects(authority.mcpLinkSearch('lo3rwang',query,5,TOKEN),
      error=>error.message===PR_WARNING);
  }
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',{},TOKEN),
    error=>error.message===PR_WARNING);
  assert.equal(calls.length,0);
});

test('Two OAuth/delegation callers never share a private MCP database result',async()=>{
  const {authority}=state();
  const calls=fakeSql(call=>Response.json({data:[{
    uid:'Ab12Cd34',title:call.authorization,createtime:'2026-11-05'
  }]}));
  const a=await authority.mcpLinkSearch('lo3rwang','對話紀錄',5,'eyJ.one.token');
  const b=await authority.mcpLinkSearch('lo3rwang','對話紀錄',5,'eyJ.two.token');
  assert.equal(calls.length,2);
  assert.notEqual(a.results[0].title,b.results[0].title);
});

test('Group Scope attachment and active grants are preserved through portable MCP cutover',async()=>{
  const {authority,data}=state();
  assert.deepEqual(await authority.mcpGroupMembers('loc'),['lo3rwang','lrunes']);
  await authority.addGroupScope('loc','thirdscope');
  assert.deepEqual(await authority.mcpGroupMembers('loc'),
    ['lo3rwang','lrunes','thirdscope']);
  await assert.rejects(authority.addGroupScope('loc','loc'),/own group/);
  const expiry=Date.now()+86400000;
  await authority.putGrant({provider:'clerk',subject:'user_A',scope:'lrunes',
    actions:['read'],expires_at:expiry});
  await authority.putGrant({provider:'clerk',subject:'user_GroupAdmin',scope:'loc',
    actions:['read'],expires_at:expiry});
  data.set('grant:clerk:user_Expired:lo3rwang',{provider:'clerk',
    subject:'user_Expired',scope:'lo3rwang',actions:['read'],expires_at:Date.now()-1000});
  const list=await authority.mcpGroupGrants('loc');
  assert.deepEqual(list.grants.map(entry=>entry.subject).sort(),['user_A','user_GroupAdmin']);
});

test('Portable MCP keeps one ZModel-backed Kysely executor without a provider Function fallback',()=>{
  const executor=readFileSync(new URL('../app/loc/providers/kysely-mcp.mjs',import.meta.url),'utf8');
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(executor,/schema as zmodel/);
  assert.match(executor,/executePortableMcp/);
  assert.match(edge,/executePortableMcp\(trx,body,claims/);
  assert.match(worker,/LOC_MCP_SQL_GATEWAY_URL/);
  assert.doesNotMatch(worker,/MANAGED_SUPABASE_EDGE|MANAGED_PUBLISHABLE_KEY|supabase\.co\/functions\/v1\//);
});


test('failed first acknowledgement appends a new batch to same UID instead of rewriting previous text',async()=>{
  const {authority}=state();
  const a='a'.repeat(64),b='b'.repeat(64);
  const firstContent='[[GalaxyLinkBatch:'+a+']]\nFirst saved message';
  const nextContent='[[GalaxyLinkBatch:'+b+']]\nSecond message';
  let saved='',uid='',attempt=0;
  const calls=fakeSql(call=>{
    if(call.body.kind==='mcp-sync'){
      attempt++;
      uid=call.body.row.uid;
      saved=call.body.row.content; // Database committed; HTTP acknowledgement was lost
      return Response.json({error:{message:'transport timed out'}},{status:503});
    }
    assert.equal(call.body.kind,'mcp-append');
    assert.equal(call.body.uid,uid);
    assert.equal(call.body.content,nextContent);
    saved+='\n'+call.body.content;
    return Response.json({data:{count:1,title:'Conversation'}});
  });
  const first={...CONVERSATION,content:firstContent,batch_id:a,append:true};
  await assert.rejects(authority.mcpSave('lo3rwang',first,TOKEN));
  const second=await authority.mcpSave('lo3rwang',{
    ...first,content:nextContent,batch_id:b,updated_at:'2026-11-01T02:00:00Z'
  },TOKEN);
  assert.equal(second.saved,true);
  assert.equal(second.uid,uid);
  assert.equal(attempt,1,'retry must never send a second full-sync write');
  assert.deepEqual(calls.map(c=>c.body.kind),['mcp-sync','mcp-append']);
  assert.equal(saved,firstContent+'\n'+nextContent);
});

test('an initial write that never committed recovers by append 404 then same-UID insert',async()=>{
  const {authority}=state();
  const batch='a'.repeat(64),content='[[GalaxyLinkBatch:'+batch+']]\nOriginal source';
  let firstUid='',storedUid='',round=0;
  const calls=fakeSql(call=>{
    round++;
    if(round===1){firstUid=call.body.row.uid;
      return Response.json({error:{message:'first transport failed'}},{status:503});}
    if(round===2){
      assert.equal(call.body.kind,'mcp-append');
      assert.equal(call.body.uid,firstUid);
      return Response.json({error:{message:'MCP conversation not found'}},{status:404});
    }
    assert.equal(call.body.kind,'mcp-sync');
    assert.equal(call.body.update_existing,true);
    storedUid=call.body.row.uid;
    return Response.json({data:{count:1}});
  });
  const payload={...CONVERSATION,content,batch_id:batch,append:true};
  await assert.rejects(authority.mcpSave('lo3rwang',payload,TOKEN));
  const second=await authority.mcpSave('lo3rwang',payload,TOKEN);
  assert.equal(second.saved,true);
  assert.equal(storedUid,firstUid);
  assert.equal(second.uid,firstUid);
  assert.deepEqual(calls.map(c=>c.body.kind),['mcp-sync','mcp-append','mcp-sync']);
});

test('the innermost Kysely retry contract never uses a full-row UPDATE',()=>{
  const source=readFileSync(new URL('../app/loc/providers/kysely-mcp.mjs',import.meta.url),'utf8');
  const start=source.indexOf("if(body.kind==='mcp-sync')");
  const end=source.indexOf("const uid=String(body.uid",start);
  const code=source.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(code,/previous\.content===row\.content/);
  assert.match(code,/MCP sync cannot overwrite a stored conversation/);
  assert.doesNotMatch(code,/trx\.updateTable\(/);
});
