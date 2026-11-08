import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleMcp as liveHandleMcp,protectedResourceMetadata,preflight,MCP_RESOURCE,LOC_OAUTH_ISSUER} from '../app/loc/mcp/router.mjs';

const b64url=bytes=>Buffer.from(bytes).toString('base64url');
const encode=x=>b64url(Buffer.from(JSON.stringify(x)));
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicKey={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
let jwksQueries=0;
let publicApiRequests=[];
const directDb={
 selectFrom(table){
  const request={table,columns:[],where:[],limit:null};
  const chain={
   select(columns){request.columns=columns;return this;},
   where(...args){request.where.push(args);return this;},
   orderBy(){return this;},limit(n){request.limit=n;return this;},
   offset(){return this;},
   async execute(){
    publicApiRequests.push(request);
    return request.columns.includes('content')?
      [{uid:'30D7AFD7',title:'LP26',content:'Galaxy real article',date:'2026-11-01'}]:
      [{uid:'30D7AFD7',title:'LP26',date:'2026-11-01'}];
   }
  };
  return chain;
 }
};
const TEST_ENV={locDirectDatabase:async()=>({db:directDb,engine:'postgres',namespace:'silver'})};
const handleMcp=(request,env=TEST_ENV)=>liveHandleMcp(request,env);
const originalFetch=globalThis.fetch;
let quotaRequests=[];
let quotaBlocked=false;
let quotaNotice='';
let privateSearchRequests=0;
globalThis.fetch=async (url,options)=>{
  if(String(url)==='https://auth.lo3rwang.cc/v1/mcp/quota'){
    const body=JSON.parse(options.body);
    if(body.action==='inspect')return Response.json({warning:quotaNotice});
    quotaRequests.push(body);
    return quotaBlocked&&body.action==='acquire'
      ?Response.json({error:'MCP request limit exceeded'},{status:429})
      :Response.json(body.action==='acquire'?{lease:'7e84c5a7-f95d-414d-82e8-e84542ee60ab'}:{released:true});
  }
  if(String(url).startsWith('https://auth.lo3rwang.cc/v1/mcp/direct-permit/')){
    privateSearchRequests++;
    assert.equal(options.method,'GET');
    assert.equal(options.headers.authorization.startsWith('Bearer eyJ'),true);
    return Response.json({authorized:true,scopeid:'lo3rwang',
      subject:'loc_'+'A'.repeat(40),action:'read'});
  }
  if(String(url)===LOC_OAUTH_ISSUER+'/.well-known/jwks.json'){
    jwksQueries++;return Response.json({keys:[publicKey]});
  }
  throw Error('unexpected fetch URL: '+url);
};
async function token(claimOverrides={}){
  const now=Math.floor(Date.now()/1000);
  const hdr=encode({alg:'RS256',kid:'test-key',typ:'JWT'});
  const body=encode({iss:LOC_OAUTH_ISSUER,sub:'loc_'+ 'A'.repeat(40),sid:'B'.repeat(43),
    email_verified:true,aud:MCP_RESOURCE,
    exp:now+300,iat:now-30,scope:'profile email',...claimOverrides});
  const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(hdr+'.'+body));
  return hdr+'.'+body+'.'+b64url(sig);
}
function req(method='POST',bearer='',body){return new Request(MCP_RESOURCE,{method,
  headers:bearer?{authorization:'Bearer '+bearer}:undefined,
  ...(body?{body:JSON.stringify(body)}:{})});}
const rpc=(method,params={})=>({jsonrpc:'2.0',id:1,method,params});

test('LOC OAuth check: anonymous GET is 401 with RFC9728 OAuth challenge',async()=>{
  const res=await handleMcp(req('GET'));
  assert.equal(res.status,401);
  assert.match(res.headers.get('www-authenticate'),/Bearer resource_metadata="https:\/\/mcp\.lo3rwang\.cc\/\.well-known\/oauth-protected-resource"/);
});
test('LOC OAuth check: metadata is public JSON with correct resource and authorization server',async()=>{
  const res=protectedResourceMetadata();
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),/application\/json/);
  assert.deepEqual(await res.json(),{resource:MCP_RESOURCE,authorization_servers:[LOC_OAUTH_ISSUER],
    bearer_methods_supported:['header'],scopes_supported:['profile','email','offline_access']});
});
test('CORS OPTIONS is public',()=>assert.equal(preflight().status,204));
test('Missing/invalid token is rejected',async()=>{
  assert.equal((await handleMcp(req('POST','bad.token',rpc('initialize')))).status,401);
  assert.equal((await handleMcp(req('POST',await token({aud:'https://other.site/mcp'}),rpc('initialize')))).status,401);
  assert.equal((await handleMcp(req('POST',await token({exp:0}),rpc('initialize')))).status,401);
});
test('concurrent valid MCP calls share public JWKS and do not trigger one LOC OAuth fetch per request',async()=>{
  const jwt=await token();
  const before=jwksQueries;
  const replies=await Promise.all(Array.from({length:12},()=>handleMcp(req('POST',jwt,rpc('initialize')))));
  assert.ok(replies.every(r=>r.status===200));
  assert.ok(jwksQueries-before<=1,'concurrent MCP calls must share one JWKS fetch');
});

test('Valid LOC OAuth JWT can initialize, discover read/write tools, and ping',async()=>{
  const jwt=await token();
  let r=await handleMcp(req('POST',jwt,rpc('initialize',{protocolVersion:'2025-06-18'})));
  assert.equal(r.status,200);assert.equal((await r.json()).result.serverInfo.name,'loc-mcp');
  r=await handleMcp(req('POST',jwt,rpc('tools/list')));
  const tools=(await r.json()).result.tools;
  assert.equal(tools[0].name,'loc_connection_status');
  r=await handleMcp(req('POST',jwt,rpc('tools/call',{name:'loc_connection_status',arguments:{}})));
  const contents=(await r.json()).result.content;
  const status=JSON.parse(contents[0].text);
  assert.equal(status.galaxyWriteSupported,true);
  assert.deepEqual(status.nativeDatabase,{publicReadConfigured:false,
    privateReadConfigured:false,privateWriteConfigured:false,
    verification:'configuration-only'});
  assert.equal(status.writeRequiresScopeAuthorization,true);
  assert.equal(status.availableTools.includes('search_memory'),false);
  assert.equal(status.availableTools.includes('search_scope'),false);
  assert.equal(status.availableTools.includes('search_group'),false);
  assert.ok(status.availableTools.includes('galaxy_link'));
  assert.equal(status.availableTools.includes('sync_conversation'),false);
  assert.ok(status.availableTools.includes('grant_scope_access'));
  assert.deepEqual(status.availableTools,tools.map(tool=>tool.name));
  const link=tools.find(tool=>tool.name==='galaxy_link');
  assert.deepEqual(link.inputSchema.required,['action','scopeid']);
  assert.deepEqual(link.inputSchema.properties.action.enum,['search','read','check','record']);
  assert.equal(Object.hasOwn(link.inputSchema.properties,'source'),false);
  assert.equal(status.availableTools.includes('update_scope_pr'),false);
  for(const field of ['uid','user_requested','title','content','updated_at'])
    assert.ok(Object.hasOwn(link.inputSchema.properties,field));
  r=await handleMcp(req('POST',jwt,rpc('ping')));
  assert.deepEqual((await r.json()).result,{});
  assert.ok(jwksQueries>=1);
});

test('MCP permits exact-UID reads but rejects all search tools',async()=>{
  const jwt=await token();
  publicApiRequests=[];
  let r=await handleMcp(req('POST',jwt,rpc('tools/list')));
  const list=(await r.json()).result.tools;
  for(const name of ['search_memory','search_scope','search_group']){
    assert.equal(list.some(t=>t.name===name),false);
    const rejected=await handleMcp(req('POST',jwt,rpc('tools/call',{name,arguments:{query:'LP26'}})));
    assert.equal((await rejected.json()).error.code,-32602);
  }
  r=await handleMcp(req('POST',jwt,rpc('tools/call',{name:'read_memory',arguments:{uid:'30D7AFD7'}})));
  assert.equal((await r.json()).result.structuredContent.content,'Galaxy real article');
  assert.equal(publicApiRequests.length,1);
});
test('MCP tool invalid input returns an error without database access',async()=>{
  const jwt=await token();
  publicApiRequests=[];
  const response=await handleMcp(req('POST',jwt,rpc('tools/call',
    {name:'read_memory',arguments:{uid:'invalid'}})));
  const result=(await response.json()).result;
  assert.equal(result.isError,true);
  assert.equal(publicApiRequests.length,0);
});
test('Direct Kysely UID read is metered; a 429 never executes SQL',async()=>{
  const jwt=await token();
  publicApiRequests=[];quotaRequests=[];
  const ok=await handleMcp(req('POST',jwt,rpc('tools/call',
    {name:'read_memory',arguments:{uid:'30D7AFD7'}})));
  assert.equal((await ok.json()).result.structuredContent.content,'Galaxy real article');
  assert.deepEqual(quotaRequests.map(x=>x.action),['acquire','release']);
  assert.equal(quotaRequests[0].kind,'read');
  assert.equal(publicApiRequests.length,1);
  quotaBlocked=true;
  const blocked=await handleMcp(req('POST',jwt,rpc('tools/call',
    {name:'read_memory',arguments:{uid:'30D7AFD7'}})));
  assert.equal((await blocked.json()).result.isError,true);
  assert.equal(publicApiRequests.length,1);
  quotaBlocked=false;
});
test.after(()=>{globalThis.fetch=originalFetch;});

test('MCP PR search is rejected before any Authority or quota request',async()=>{
  const jwt=await token(),before=quotaRequests.length;
  const response=await handleMcp(req('POST',jwt,rpc('tools/call',{
    name:'galaxy_link',arguments:{action:'search',scopeid:'lo3rwang',query:'PR #1170'}})));
  const output=(await response.json()).result;
  assert.equal(output.isError,true);
  assert.equal(output.content[0].text,'請至github頁面找尋PR相關資料！不開放搜尋PR!');
  assert.equal(quotaRequests.length,before);
});

test('PR denial and the approaching QoS warning appear as two lines, without spending search quota',async()=>{
 const jwt=await token(),before=quotaRequests.length,searches=privateSearchRequests;
 quotaNotice='提醒！MCP QoS 即將達到限制，請放慢呼叫頻率。';
 try{
  const response=await handleMcp(req('POST',jwt,rpc('tools/call',{
   name:'galaxy_link',arguments:{action:'search',scopeid:'lo3rwang',
    query:'PR #9999',user_requested:true}
  })));
  const result=(await response.json()).result;
  assert.equal(result.isError,true);
  assert.deepEqual(result.content[0].text.split('\n'),[
   '請至github頁面找尋PR相關資料！不開放搜尋PR!',
   quotaNotice
  ]);
  assert.equal(quotaRequests.length,before,'quota inspection must not count as acquire/release');
  assert.equal(privateSearchRequests,searches,'PR query cannot reach private Galaxy SQL');
 }finally{quotaNotice='';}
});

test('search is rejected unless the user-requested flag is true',async()=>{
 const jwt=await token(),before=privateSearchRequests;
 const denied=await handleMcp(req('POST',jwt,rpc('tools/call',{
  name:'galaxy_link',arguments:{action:'search',scopeid:'lo3rwang',query:'時間定錨'}
 })));
 assert.equal((await denied.json()).result.isError,true);
 assert.equal(privateSearchRequests,before);
 const allowed=await handleMcp(req('POST',jwt,rpc('tools/call',{
  name:'galaxy_link',arguments:{action:'search',scopeid:'lo3rwang',
   query:'時間定錨',user_requested:true}
 })));
 assert.equal((await allowed.json()).result.isError,undefined);
 assert.equal(privateSearchRequests,before+1);
 const last=quotaRequests.filter(x=>x.action==='acquire').at(-1);
 assert.equal(last.kind,'search','native private search preserves five-minute QoS');
});

test('independent native password account can connect MCP before optional email verification, without gaining a Scope grant',async()=>{
 const jwt=await token({email_verified:false});
 const initialize=await handleMcp(req('POST',jwt,rpc('initialize')));
 assert.equal(initialize.status,200);
 const status=await handleMcp(req('POST',jwt,rpc('tools/call',{
  name:'loc_connection_status',arguments:{}
 })));
 assert.equal(status.status,200);
 const body=(await status.json()).result;
 assert.equal(JSON.parse(body.content[0].text).subject,'loc_'+ 'A'.repeat(40));
 const invalid=await handleMcp(req('POST',await token({email_verified:'false'}),rpc('initialize')));
 assert.equal(invalid.status,401,'email verification claim must be a real boolean');
});
