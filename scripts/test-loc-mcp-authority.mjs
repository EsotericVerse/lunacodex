import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace(/^import[\\s\\S]*?;\\s*$/gm,'')
  .replace('export class LocAuthorityState','class LocAuthorityState')
  .replace('export default {','const worker={');
const {LocAuthorityState}=new Function('DurableObject',
  source+';return {LocAuthorityState};')(class{
    constructor(ctx,env){this.ctx=ctx;this.env=env;}
  });
function state(){
  const saved=new Map();
  const storage={
    get:async key=>saved.get(key),
    put:async(key,value)=>{saved.set(key,value);},
    delete:async key=>{saved.delete(key);},
    list:async({prefix})=>new Map([...saved].filter(([key])=>key.startsWith(prefix)))
  };
  const env={LOC_CONTROL_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64')};
  return {do:new LocAuthorityState({storage},env),saved};
}
const profile={endpoint:'https://db.example.org/rest/v1',schema:'silver',
  table:'galaxy',api_key:'sensitive-do-not-expose'};
const conversation={conversation_id:'chat-1',updated_at:'2026-11-01T01:00:00Z',
  created_at:'2026-11-01T00:00:00Z',title:'Test',content:'First version'};
const originalFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=originalFetch;});

test('managed Clerk MCP authorization recognizes actual verified email addresses',()=>{
  for(const path of ['../workers/loc-authority/index.mjs','../supabase/functions/loc-kysely/index.ts']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    const literal=source.match(/\/\^\[\^[^\n]+?\$\/(?=\.test\()/)?.[0];
    assert.ok(literal,'Managed email matcher must exist');
    const pattern=new Function('return '+literal)();
    assert.equal(pattern.test('abc@example.org'),true,path);
    assert.equal(pattern.test('a b@example.org'),false,path);
    assert.equal(pattern.test('missing-domain'),false,path);
  }
});

test('encrypted Scope credentials never appear in public settings',async()=>{
  const {do:authority,saved}=state();
  const configured=await authority.putMcpScope('lrunes',profile);
  assert.equal(configured.configured,true);
  assert.equal(configured.api_key,undefined);
  const publicValue=await authority.getMcpScope('lrunes');
  assert.equal(publicValue.api_key,undefined);
  assert.doesNotMatch(JSON.stringify(publicValue),/sensitive-do-not-expose/);
  assert.doesNotMatch(JSON.stringify([...saved.values()]),/sensitive-do-not-expose/);
  const secret=await authority.mcpPrivateProfile('lrunes');
  assert.equal(secret.api_key,profile.api_key);
  await authority.putMcpScope('lrunes',{...profile,table:'another',api_key:''});
  assert.equal((await authority.mcpPrivateProfile('lrunes')).api_key,profile.api_key);
});

test('no changed conversation means no database read or write',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  let writes=0;
  globalThis.fetch=async()=>{writes++;return new Response(null,{status:204});};
  const first=await authority.mcpSave('lo3rwang',conversation);
  const before=await authority.mcpCheckpoint('lo3rwang','chat-1',conversation.updated_at);
  const unchanged=await authority.mcpSave('lo3rwang',conversation);
  assert.equal(first.saved,true);
  assert.equal(before.needs_save,false);
  assert.equal(unchanged.saved,false);
  assert.equal(writes,1);
  assert.equal(first.saved_at!=null,true);
  assert.equal(first.updated_at,conversation.updated_at);
});

test('failed save is retried with same UID and saved_at remains unchanged',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  let failedUid='',successfulUid='',attempts=0;
  globalThis.fetch=async(_url,options)=>{
    attempts++;
    if(attempts===1){failedUid=JSON.parse(options.body).uid;return new Response(null,{status:503});}
    successfulUid=JSON.parse(options.body).uid;
    return new Response(null,{status:204});
  };
  await assert.rejects(authority.mcpSave('lo3rwang',conversation),/HTTP 503/);
  const progress=await authority.mcpCheckpoint('lo3rwang','chat-1',conversation.updated_at);
  assert.equal(progress.needs_save,true);
  assert.equal(progress.saved_at,null);
  const result=await authority.mcpSave('lo3rwang',conversation);
  assert.equal(result.saved,true);
  assert.equal(result.uid,failedUid);
  assert.equal(successfulUid,failedUid);
});

test('100 parallel writes of one unchanged version create one article',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  let writes=0;
  globalThis.fetch=async()=>{writes++;return new Response(null,{status:204});};
  const all=await Promise.all(Array.from({length:100},
    ()=>authority.mcpSave('lo3rwang',conversation)));
  assert.equal(all.filter(x=>x.saved).length,1);
  assert.equal(writes,1);
});

test('built-in Scope advertises managed storage without requesting API keys',async()=>{
  const {do:authority}=state();
  const info=await authority.getMcpScope('lo3rwang');
  assert.equal(info.configured,true);
  assert.equal(info.managed,true);
  assert.equal(info.schema,'silver');
  assert.equal(info.table,'lo3rwang_galaxy');
  assert.equal(info.api_key,undefined);
  assert.deepEqual(await authority.getMcpScope('thirdscope'),{
    scopeid:'thirdscope',configured:false
  });
});

test('built-in Scope can sync through existing Kysely without a user-supplied API key',async()=>{
  const {do:authority}=state();
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),body:JSON.parse(options.body),auth:options.headers.authorization});
    return Response.json({data:{count:1}});
  };
  const oauth='eyJ.verified.mcp';
  const first=await authority.mcpSave('lo3rwang',conversation,oauth);
  const same=await authority.mcpSave('lo3rwang',conversation,oauth);
  const changed=await authority.mcpSave('lo3rwang',{
    ...conversation,updated_at:'2026-11-01T02:00:00Z',content:'New version'
  },oauth);
  assert.equal(first.saved,true);
  assert.equal(same.saved,false);
  assert.equal(changed.saved,true);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://qlouywsdiiyiyzpoxyqy.supabase.co/functions/v1/loc-kysely-clerk');
  assert.equal(calls[0].body.scopeid,'lo3rwang');
  assert.equal(calls[0].body.kind,'mcp-sync');
  assert.equal(calls[0].body.update_existing,false);
  assert.equal(calls[1].body.update_existing,true);
  assert.equal(calls[1].body.row.uid,calls[0].body.row.uid);
  assert.equal(calls[0].body.row.site,'mcp');
  assert.equal(calls[1].body.row.site,'mcp');
  for(const key of ['statics','culture','search','trace','list','keyword','others','extract'])
    assert.equal(calls[0].body.row[key],false);
  assert.equal(calls[1].body.row.list,false);
  assert.equal(Object.hasOwn(calls[0].body.row,'able'),false);
  assert.equal(calls[0].auth,'Bearer '+oauth);
});
test('managed Scope rejects missing OAuth token and does not mark saved',async()=>{
  const {do:authority}=state();
  await assert.rejects(authority.mcpSave('lo3rwang',conversation),/MCP OAuth authorization required/);
  const status=await authority.mcpCheckpoint('lo3rwang','chat-1',conversation.updated_at);
  assert.equal(status.needs_save,true);
  assert.equal(status.saved_at,null);
});

const prUpdate={uid:'561DFE49',pr_number:968,title:'PR #968 release notes',
  content:'Updated body',updated_at:'2026-11-03T01:00:00Z'};

test('update_scope_pr sends a dedicated kind and never the mcp-sync shape',async()=>{
  const {do:authority}=state();
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),body:JSON.parse(options.body)});
    return Response.json({data:{count:1}});
  };
  const result=await authority.mcpUpdatePr('lo3rwang',prUpdate,'eyJ.authorized.mcp');
  assert.equal(result.updated,true);
  assert.equal(result.uid,'561DFE49');
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.kind,'mcp-update-pr');
  assert.equal(calls[0].body.uid,'561DFE49');
  assert.equal(calls[0].body.pr_number,968);
  assert.equal(calls[0].body.title,prUpdate.title);
  assert.equal(calls[0].body.content,prUpdate.content);
});

test('update_scope_pr rejects missing OAuth token without any network call',async()=>{
  const {do:authority}=state();
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw Error('Unexpected anonymous fetch');};
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',prUpdate),/MCP OAuth authorization required/);
  assert.equal(requests,0);
});

test('update_scope_pr surfaces the backend refusal reason (not GitHub-origin / PR mismatch)',async()=>{
  const {do:authority}=state();
  globalThis.fetch=async()=>Response.json(
    {error:{message:"PR number does not match this article's title"}},{status:403});
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',prUpdate,'eyJ.authorized.mcp'),
    /PR number does not match this article's title/);
});

test('update_scope_pr rejects an invalid uid, pr_number or oversized content before any network call',async()=>{
  const {do:authority}=state();
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw Error('Unexpected fetch');};
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',{...prUpdate,uid:'too-short'},'eyJ.x'),/Invalid case-sensitive UID/);
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',{...prUpdate,pr_number:0},'eyJ.x'),/Invalid PR number/);
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',{...prUpdate,pr_number:1.5},'eyJ.x'),/Invalid PR number/);
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',{...prUpdate,content:''},'eyJ.x'),/Invalid article title or content/);
  assert.equal(requests,0);
});

test('self-hosted Scope profile: update_scope_pr reads before writing and refuses a non-GitHub article',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    if((options.method||'GET')==='GET')
      return Response.json([{uid:'561DFE49',title:'PR #968 release notes',site:'mcp'}]);
    return new Response(null,{status:204});
  };
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',prUpdate,'eyJ.x'),
    /Only MCP PR-origin articles can be updated/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'GET');
});

test('self-hosted Scope profile: update_scope_pr refuses a PR-number/title mismatch and never PATCHes',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    if((options.method||'GET')==='GET')
      return Response.json([{uid:'561DFE49',title:'PR #1 unrelated article',site:'mcp'}]);
    return new Response(null,{status:204});
  };
  await assert.rejects(authority.mcpUpdatePr('lo3rwang',prUpdate,'eyJ.x'),
    /PR number does not match this article's title/);
  assert.equal(calls.length,1);
});

test('self-hosted Scope profile: update_scope_pr PATCHes by uid once the GitHub PR match is confirmed',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
    if((options.method||'GET')==='GET')
      return Response.json([{uid:'561DFE49',title:'PR #968 release notes',site:'mcp'}]);
    return new Response(null,{status:204});
  };
  const result=await authority.mcpUpdatePr('lo3rwang',prUpdate,'eyJ.x');
  assert.equal(result.updated,true);
  assert.equal(calls.length,2);
  assert.equal(calls[1].method,'PATCH');
  assert.match(calls[1].url,/uid=eq\.561DFE49/);
  assert.equal(calls[1].body.title,prUpdate.title);
  assert.equal(calls[1].body.content,prUpdate.content);
});

test('100 concurrent matching searches make one provider request per Scope',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  let reads=0;
  globalThis.fetch=async()=>{reads++;return Response.json([
    {uid:'1B066147',title:'LP26',date:'2026-11-01'}]);};
  const rows=await Promise.all(Array.from({length:100},
    ()=>authority.mcpSearch('lo3rwang','LP26',10)));
  assert.equal(rows.length,100);
  assert.equal(rows[0].results[0].uid,'1B066147');
  assert.equal(reads,1);
});


test('managed private Scope uses the verified OAuth Kysely edge for search and exact UID read',async()=>{
  const {do:authority}=state();
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    calls.push({url:String(url),body,auth:options.headers.authorization});
    return Response.json({data:body.kind==='mcp-search'?
      [{uid:'561DFE49',title:'PR #865',date:'2026-11-02'}]:
      [{uid:'561DFE49',title:'PR #865',content:'Private changelog',
        searchable:false,date:'2026-11-02'}]});
  };
  const bearer='eyJ.authorized.mcp';
  const found=await authority.mcpSearch('lo3rwang','PR #865',5,bearer);
  assert.equal(found.results[0].uid,'561DFE49');
  const read=await authority.mcpRead('lo3rwang','561DFE49',0,100,bearer);
  assert.equal(read.found,true);
  assert.equal(read.content,'Private changelog');
  assert.deepEqual(calls.map(x=>x.body.kind),['mcp-search','mcp-read']);
  assert.deepEqual(calls.map(x=>x.body.scopeid),['lo3rwang','lo3rwang']);
  assert.ok(calls.every(x=>x.auth==='Bearer '+bearer));
  assert.ok(calls.every(x=>x.url.includes('/functions/v1/loc-kysely-clerk')));
  assert.ok(calls.every(x=>!x.url.includes('/rest/v1/')));
});

test('managed private search does not share results across OAuth callers',async()=>{
  const {do:authority}=state();
  let requests=0;
  globalThis.fetch=async(_url,options)=>{
    requests++;
    const caller=options.headers.authorization;
    return Response.json({data:[{uid:'561DFE49',title:caller,date:'2026-11-02'}]});
  };
  const first=await authority.mcpSearch('lo3rwang','PR #865',5,'eyJ.caller.one');
  const second=await authority.mcpSearch('lo3rwang','PR #865',5,'eyJ.caller.two');
  assert.equal(requests,2);
  assert.notEqual(first.results[0].title,second.results[0].title);
});

test('managed private reads fail closed when no OAuth token is supplied',async()=>{
  const {do:authority}=state();
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw Error('Unexpected anonymous fetch');};
  await assert.rejects(authority.mcpRead('lo3rwang','561DFE49'),/OAuth authorization required/);
  await assert.rejects(authority.mcpSearch('lo3rwang','PR #865'),/OAuth authorization required/);
  assert.equal(requests,0);
});

test('Scope Group membership is explicit beyond its existing built-in Scopes',async()=>{
  const {do:authority}=state();
  assert.deepEqual(await authority.mcpGroupMembers('loc'),['lo3rwang','lrunes']);
  await authority.addGroupScope('loc','thirdscope');
  assert.deepEqual(await authority.mcpGroupMembers('loc'),
    ['lo3rwang','lrunes','thirdscope']);
  await assert.rejects(authority.addGroupScope('loc','loc'),/own group/);
});

test('Group grant listing exposes only active Clerk grants of that Group members',async()=>{
  const {do:authority,saved}=state();
  const expiry=Date.now()+86400000;
  const grant=(scope,subject)=>authority.putGrant({provider:'clerk',subject,scope,
    actions:['read','configure'],expires_at:expiry});
  await grant('lrunes','user_A');
  await grant('outsidescope','user_B');
  await grant('loc','user_GroupAdmin');
  await authority.putGrant({provider:'secondary',subject:'external_user',scope:'lo3rwang',
    actions:['read'],expires_at:expiry});
  saved.set('grant:clerk:user_Expired:lo3rwang',{provider:'clerk',
    subject:'user_Expired',scope:'lo3rwang',actions:['read'],expires_at:Date.now()-1000});
  const result=await authority.mcpGroupGrants('loc');
  assert.deepEqual(result.members,['loc','lo3rwang','lrunes']);
  assert.deepEqual(result.grants.map(x=>x.subject).sort(),['user_A','user_GroupAdmin']);
  assert.equal((await authority.mcpGroupGrants('othergroup')).grants.length,0);
});

test('Galaxy Link search only queries site=mcp in its authorized Scope',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  let requested='';
  globalThis.fetch=async url=>{
    requested=String(url);
    return Response.json([{uid:'Ab12Cd34',title:'One topic',createtime:'2026-11-05T00:00:00Z'}]);
  };
  const value=await authority.mcpLinkSearch('another', 'access rights', 3);
  assert.equal(value.results.length,1);
  const url=new URL(requested);
  assert.equal(url.searchParams.get('site'),'eq.mcp');
  assert.equal(url.searchParams.get('limit'),'3');
  assert.equal(url.searchParams.has('uid'),false);
  await assert.rejects(authority.mcpLinkSearch('another','a',3),/Invalid Galaxy Link search/);
});

test('Galaxy Link append is idempotent after lost checkpoint acknowledgment',async()=>{
  const {do:authority,saved}=state();
  authority.mcpPrivateProfile=async()=>profile;
  const batch='a'.repeat(64);
  const newContent='[[GalaxyLinkBatch:'+batch+']]\ncorrected statement';
  let current='earlier statement',patches=0;
  globalThis.fetch=async (_url,options)=>{
    if(options.method==='GET')return Response.json([{
      uid:'Ab12Cd34',site:'mcp',content:current,
      title:'Galaxy Link topic',createtime:'2026-11-05T00:00:00Z'}]);
    if(options.method==='PATCH'){
      patches++;
      current=JSON.parse(options.body).content;
      return Response.json([{uid:'Ab12Cd34'}]);
    }
    return new Response(null,{status:204});
  };
  const payload={conversation_id:'chat-A',uid:'Ab12Cd34',
    updated_at:'2026-11-05T01:00:00Z',title:'',
    content:newContent,batch_id:batch,append:true};
  const first=await authority.mcpSave('thirdscope',payload);
  assert.equal(first.appended,true);
  assert.equal(current,'earlier statement\n'+newContent);
  assert.equal(patches,1);
  // Database committed, but Durable Object acknowledgement was lost.
  await authority.ctx.storage.put('mcp-sync:thirdscope:chat-A',
    {uid:'Ab12Cd34',updated_at:null,saved_at:null});
  const repeated=await authority.mcpSave('thirdscope',payload);
  assert.equal(repeated.saved,true);
  assert.equal(patches,1);
  assert.equal(current,'earlier statement\n'+newContent);
  const skipped=await authority.mcpSave('thirdscope',payload);
  assert.equal(skipped.saved,false);
  assert.equal(patches,1);
});


test('Galaxy Link update_pr locates managed GitHub PR without a user-supplied UID',async()=>{
  const {do:authority}=state();
  const calls=[];
  globalThis.fetch=async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return Response.json({data:{count:1,uid:'Ab12Cd34'}});
  };
  const input={...prUpdate};
  delete input.uid;
  const result=await authority.mcpUpdatePr('lo3rwang',input,'eyJ.authorized.mcp');
  assert.equal(result.uid,'Ab12Cd34');
  assert.equal(result.pr_number,968);
  assert.equal(calls.length,1);
  assert.equal(Object.hasOwn(calls[0],'uid'),false);
  assert.equal(calls[0].kind,'mcp-update-pr');
  assert.equal(calls[0].pr_number,968);
});

test('portable Scope finds only one original GitHub PR by canonical site_id',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  const events=[];
  globalThis.fetch=async(url,options={})=>{
    const target=new URL(url);
    events.push({method:options.method||'GET',siteid:target.searchParams.get('site_id'),
      uid:target.searchParams.get('uid')});
    if(target.searchParams.get('site_id'))
      return Response.json([{uid:'Ab12Cd34',title:'LOC｜PR #968｜紀錄',
        site:'mcp',site_id:'EsotericVerse/moon-runes-pwa#968'}]);
    if((options.method||'GET')==='GET')
      return Response.json([{uid:'Ab12Cd34',title:'LOC｜PR #968｜紀錄',
        site:'mcp',site_id:'EsotericVerse/moon-runes-pwa#968'}]);
    return new Response(null,{status:204});
  };
  const input={...prUpdate};delete input.uid;
  const result=await authority.mcpUpdatePr('external',input,'eyJ.authorized.mcp');
  assert.equal(result.uid,'Ab12Cd34');
  assert.equal(events.length,3);
  assert.equal(events[0].siteid,'eq.EsotericVerse/moon-runes-pwa#968');
  assert.equal(events[1].uid,'eq.Ab12Cd34');
  assert.equal(events[2].method,'PATCH');
});

test('portable PR update refuses ambiguous source identity without modifying anything',async()=>{
  const {do:authority}=state();
  authority.mcpPrivateProfile=async()=>profile;
  let writes=0;
  globalThis.fetch=async(_url,options={})=>{
    if(options.method==='PATCH')writes++;
    return Response.json([
      {uid:'Ab12Cd34',site:'mcp',title:'PR #968',site_id:'EsotericVerse/moon-runes-pwa#968'},
      {uid:'Ba21Dc43',site:'mcp',title:'PR #968',site_id:'EsotericVerse/moon-runes-pwa#968'}
    ]);
  };
  const input={...prUpdate};delete input.uid;
  await assert.rejects(authority.mcpUpdatePr('external',input,'eyJ.authorized.mcp'),/Multiple PR records/);
  assert.equal(writes,0);
});

test('Galaxy Link search is fixed to site=mcp without caller-selectable site parameter',async()=>{
  const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(source,/site:'eq\.mcp'/);
  assert.match(source,/mcp-search',\{query,limit\}/);
  assert.doesNotMatch(source,/site:'eq\.'\+source/);
  assert.match(source,/Object\.keys\(args\)\.some\(key=>!\['query','limit'\]\.includes\(key\)\)/);
});
