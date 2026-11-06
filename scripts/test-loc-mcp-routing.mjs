import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleMcp,protectedResourceMetadata,preflight,MCP_RESOURCE,CLERK_ISSUER} from '../app/loc/mcp/router.mjs';

const b64url=bytes=>Buffer.from(bytes).toString('base64url');
const encode=x=>b64url(Buffer.from(JSON.stringify(x)));
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicKey={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
const originalFetch=globalThis.fetch;
let jwksQueries=0;
let publicApiRequests=[];
let quotaRequests=[];
let quotaBlocked=false;
globalThis.fetch=async (url,options)=>{
  if(String(url)==='https://auth.lo3rwang.cc/v1/mcp/quota'){
    const body=JSON.parse(options.body);
    quotaRequests.push(body);
    return quotaBlocked&&body.action==='acquire'
      ?Response.json({error:'MCP request limit exceeded'},{status:429})
      :Response.json(body.action==='acquire'?{lease:'7e84c5a7-f95d-414d-82e8-e84542ee60ab'}:{released:true});
  }
  if(String(url)===CLERK_ISSUER+'/.well-known/jwks.json'){
    jwksQueries++;return Response.json({keys:[publicKey]});
  }
  if(String(url).startsWith('https://qlouywsdiiyiyzpoxyqy.supabase.co/rest/v1/')){
    publicApiRequests.push({url:String(url),options});
    const params=new URL(url).searchParams;
    return Response.json(params.has('uid')?
      [{uid:'30D7AFD7',title:'LP26',content:'Galaxy real article',date:'2026-11-01'}]:
      [{uid:'30D7AFD7',title:'LP26',date:'2026-11-01'}]);
  }
  throw Error('unexpected fetch URL: '+url);
};
async function token(claimOverrides={}){
  const now=Math.floor(Date.now()/1000);
  const hdr=encode({alg:'RS256',kid:'test-key',typ:'JWT'});
  const body=encode({iss:CLERK_ISSUER,sub:'user_12345',aud:MCP_RESOURCE,
    exp:now+3600,iat:now-30,scope:'profile email',...claimOverrides});
  const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(hdr+'.'+body));
  return hdr+'.'+body+'.'+b64url(sig);
}
function req(method='POST',bearer='',body){return new Request(MCP_RESOURCE,{method,
  headers:bearer?{authorization:'Bearer '+bearer}:undefined,
  ...(body?{body:JSON.stringify(body)}:{})});}
const rpc=(method,params={})=>({jsonrpc:'2.0',id:1,method,params});

test('Clerk check: anonymous GET is 401 with RFC9728 OAuth challenge',async()=>{
  const res=await handleMcp(req('GET'));
  assert.equal(res.status,401);
  assert.match(res.headers.get('www-authenticate'),/Bearer resource_metadata="https:\/\/mcp\.lo3rwang\.cc\/\.well-known\/oauth-protected-resource"/);
});
test('Clerk check: metadata is public JSON with correct resource and authorization server',async()=>{
  const res=protectedResourceMetadata();
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),/application\/json/);
  assert.deepEqual(await res.json(),{resource:MCP_RESOURCE,authorization_servers:[CLERK_ISSUER],
    bearer_methods_supported:['header'],scopes_supported:['profile','email']});
});
test('CORS OPTIONS is public',()=>assert.equal(preflight().status,204));
test('Missing/invalid token is rejected',async()=>{
  assert.equal((await handleMcp(req('POST','bad.token',rpc('initialize')))).status,401);
  assert.equal((await handleMcp(req('POST',await token({aud:'https://other.site/mcp'}),rpc('initialize')))).status,401);
  assert.equal((await handleMcp(req('POST',await token({exp:0}),rpc('initialize')))).status,401);
});
test('concurrent valid MCP calls share public JWKS and do not trigger one Clerk fetch per request',async()=>{
  const jwt=await token();
  const before=jwksQueries;
  const replies=await Promise.all(Array.from({length:12},()=>handleMcp(req('POST',jwt,rpc('initialize')))));
  assert.ok(replies.every(r=>r.status===200));
  assert.ok(jwksQueries-before<=1,'concurrent MCP calls must share one JWKS fetch');
});

test('Valid Clerk JWT can initialize, discover read/write tools, and ping',async()=>{
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
  assert.deepEqual(link.inputSchema.properties.action.enum,['search','read','check','record','update_pr']);
  assert.equal(Object.hasOwn(link.inputSchema.properties,'source'),false);
  assert.equal(status.availableTools.includes('update_scope_pr'),false);
  for(const field of ['uid','pr_number','title','content','updated_at'])
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
test('Public UID read is metered; 429 never reaches Supabase',async()=>{
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
