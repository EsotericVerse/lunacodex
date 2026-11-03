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
globalThis.fetch=async (url,options)=>{
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
  assert.match(res.headers.get('www-authenticate'),/Bearer resource_metadata="https:\/\/loc\.lo3rwang\.cc\/\.well-known\/oauth-protected-resource\/mcp"/);
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
  assert.ok(status.availableTools.includes('search_memory'));
  assert.ok(status.availableTools.includes('read_scope'));
  assert.ok(status.availableTools.includes('sync_conversation'));
  assert.ok(status.availableTools.includes('grant_scope_access'));
  assert.deepEqual(status.availableTools,tools.map(tool=>tool.name));
  const sync=tools.find(tool=>tool.name==='sync_conversation');
  assert.equal(sync.inputSchema.required.includes('content'),true);
  assert.notEqual(sync.annotations?.readOnlyHint,true);
  assert.ok(status.availableTools.includes('update_scope_pr'));
  const updatePr=tools.find(tool=>tool.name==='update_scope_pr');
  assert.deepEqual(updatePr.inputSchema.required,
    ['scopeid','uid','pr_number','title','content','updated_at']);
  assert.notEqual(updatePr.annotations?.readOnlyHint,true);
  r=await handleMcp(req('POST',jwt,rpc('ping')));
  assert.deepEqual((await r.json()).result,{});
  assert.ok(jwksQueries>=1);
});

test('Clerk OAuth can call Galaxy public search and read without forwarding bearer token',async()=>{
  const jwt=await token();
  publicApiRequests=[];
  let r=await handleMcp(req('POST',jwt,rpc('tools/list')));
  const list=(await r.json()).result.tools;
  assert.ok(list.some(t=>t.name==='search_memory'));
  assert.ok(list.some(t=>t.name==='read_memory'));
  r=await handleMcp(req('POST',jwt,rpc('tools/call',{name:'search_memory',arguments:{query:'LP26'}})));
  const search=(await r.json()).result;
  assert.equal(search.structuredContent.results[0].uid,'30D7AFD7');
  r=await handleMcp(req('POST',jwt,rpc('tools/call',{name:'read_memory',arguments:{uid:'30D7AFD7'}})));
  const article=(await r.json()).result;
  assert.equal(article.structuredContent.content,'Galaxy real article');
  assert.equal(publicApiRequests.length,2);
  assert.ok(publicApiRequests.every(x=>!x.options.headers.authorization));
  assert.ok(publicApiRequests.every(x=>x.options.headers.apikey==='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV'));
});
test('MCP tool invalid input returns an error without database access',async()=>{
  const jwt=await token();
  publicApiRequests=[];
  const response=await handleMcp(req('POST',jwt,rpc('tools/call',
    {name:'search_memory',arguments:{query:'A'}})));
  const result=(await response.json()).result;
  assert.equal(result.isError,true);
  assert.equal(publicApiRequests.length,0);
});
test.after(()=>{globalThis.fetch=originalFetch;});
