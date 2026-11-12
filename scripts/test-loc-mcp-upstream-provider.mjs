import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {trustedProviderUrl} from '../app/loc/mcp/upstream-providers.mjs';
import {providerStoreReady,vaultPut,vaultGet,providerKey,hashValue}
  from '../app/loc/mcp/upstream-vault.mjs';
import {beginUpstreamOAuth,completeUpstreamOAuth,
  upstreamConnection,disconnectUpstream} from '../app/loc/mcp/upstream-oauth.mjs';
import {providerStatuses,requestTool,pendingApprovals,
  decideApproval,approvalReceipt,clearToolPolicies} from '../app/loc/mcp/upstream-policy.mjs';
const SUBJECT='loc_'+'A'.repeat(40);
const OTHER='loc_'+'B'.repeat(40);
function fixture(){
  const values=new Map();
  return {LOC_MCP_PROVIDER_ENCRYPTION_KEY:'test-only-64-byte-key-'+ 'X'.repeat(64),
    LOC_MCP_PROVIDER_OAUTH_JSON:JSON.stringify({github:{
      client_id:'existing-github-oauth-app',client_secret:'test-only-app-secret',scope:'read:user'}}),
    LOC_MCP_PROVIDER_STORE:{
      get:async key=>values.get(key)||null,
      put:async(key,value)=>{values.set(key,value)},
      delete:async key=>{values.delete(key)},
      list:async({prefix,limit})=>({keys:[...values.keys()].filter(x=>x.startsWith(prefix))
        .slice(0,limit).map(name=>({name}))})
    },values};
}
test('provider registry is a strict outbound allowlist',()=>{
  assert.match(trustedProviderUrl('neon','https://oauth2.neon.tech/oauth2/auth'),/^https:/);
  assert.throws(()=>trustedProviderUrl('neon','https://evil.example/token'));
  assert.throws(()=>trustedProviderUrl('github','http://github.com/login/oauth/authorize'));
  assert.throws(()=>trustedProviderUrl('github','https://github.com.evil.example/token'));
});
test('vault requires explicit binding, encrypts per subject and binds ciphertext to its key',async()=>{
  assert.equal(providerStoreReady({}),false);
  const env=fixture();
  const id=await providerKey(SUBJECT,'clerk');
  const other=await providerKey(OTHER,'clerk');
  assert.notEqual(id,other);
  await vaultPut(env,id,{access_token:'not-plaintext'});
  assert.doesNotMatch(env.values.get(id),/not-plaintext/);
  assert.equal((await vaultGet(env,id)).access_token,'not-plaintext');
  env.values.set(other,env.values.get(id));
  await assert.rejects(()=>vaultGet(env,other));
});
test('GitHub first authorization requires external code and does not accept LOC token as GitHub token',async()=>{
  const env=fixture();
  const consent=await beginUpstreamOAuth(env,SUBJECT,'github');
  const u=new URL(consent.authorize_url);
  assert.equal(u.hostname,'github.com');
  assert.equal(u.searchParams.get('client_id'),'existing-github-oauth-app');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  const state=u.searchParams.get('state');
  const saved=await vaultGet(env,'state:'+state);
  assert.equal(saved.subject,SUBJECT);
  assert.equal(u.searchParams.get('code_challenge'),await hashValue(saved.verifier));
  await assert.rejects(()=>completeUpstreamOAuth(env,{state,code:'code'},OTHER),
    /identity mismatch/);
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(address)=>{
    calls++;assert.equal(String(address),'https://github.com/login/oauth/access_token');
    return Response.json({access_token:'github-external-access',refresh_token:'github-refresh',expires_in:3600});
  };
  try{
    await completeUpstreamOAuth(env,{state,code:'upstream-code'},SUBJECT);
    assert.equal((await upstreamConnection(env,SUBJECT,'github')).access_token,'github-external-access');
    assert.equal(await upstreamConnection(env,OTHER,'github'),null);
    await assert.rejects(()=>completeUpstreamOAuth(env,{state,code:'replay'},SUBJECT));
    assert.equal(calls,1);
    await disconnectUpstream(env,SUBJECT,'github');
    assert.equal(await upstreamConnection(env,SUBJECT,'github'),null);
  }finally{globalThis.fetch=original}
});
test('function governance defaults to deny; ask requires fresh pending and human decision',async()=>{
  const env=fixture();
  await vaultPut(env,await providerKey(SUBJECT,'clerk'),{
    access_token:'clerk-token',expires_at:Date.now()+3600000});
  let status=await providerStatuses(env,SUBJECT);
  assert.equal(status.providers.find(x=>x.id==='clerk').connected,true);
  const blocked=await requestTool(env,SUBJECT,'clerk','create_user',{email:'test@example.com'});
  assert.equal(blocked.status,'denied');
  const policy='policy:'+await hashValue(SUBJECT)+':clerk';
  await vaultPut(env,policy,{create_user:'ask'});
  const queued=await requestTool(env,SUBJECT,'clerk','create_user',{email:'test@example.com'});
  assert.equal(queued.status,'approval_required');
  assert.equal((await pendingApprovals(env,SUBJECT)).length,1);
  assert.equal((await pendingApprovals(env,OTHER)).length,0);
  const refused=await decideApproval(env,SUBJECT,queued.approval_id,false);
  assert.equal(refused.status,'rejected');
  assert.equal((await approvalReceipt(env,SUBJECT,queued.approval_id)).status,'rejected');
  await assert.rejects(()=>decideApproval(env,SUBJECT,queued.approval_id,true));
  await clearToolPolicies(env,SUBJECT,'clerk');
  assert.equal((await pendingApprovals(env,SUBJECT)).length,0);
  status=await providerStatuses(env,SUBJECT);
  assert.deepEqual(status.providers.find(x=>x.id==='clerk').policies,{});
});
test('auto mode sends only provider bearer; never forwards LOC Auth credentials',async()=>{
  const env=fixture();
  await vaultPut(env,await providerKey(SUBJECT,'clerk'),{
    access_token:'clerk-upstream-token',expires_at:Date.now()+3600000});
  await vaultPut(env,'policy:'+await hashValue(SUBJECT)+':clerk',{whoami:'auto'});
  const original=globalThis.fetch;let calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    assert.equal(options.headers.authorization,'Bearer clerk-upstream-token');
    assert.notEqual(options.headers.authorization,'Bearer loc-auth-token');
    const item=JSON.parse(options.body);
    if(item.method==='notifications/initialized')return new Response(null,{status:202});
    const result=item.method==='initialize'?
      {protocolVersion:'2025-11-25',capabilities:{}}:
      {content:[{type:'text',text:'Clerk authorized'}]};
    return Response.json({jsonrpc:'2.0',id:item.id,result});
  };
  try{
    const value=await requestTool(env,SUBJECT,'clerk','whoami',{});
    assert.equal(value.status,'executed');
    assert.equal(value.result.content[0].text,'Clerk authorized');
    assert.deepEqual(calls.map(x=>JSON.parse(x.options.body).method),
      ['initialize','notifications/initialized','tools/call']);
  }finally{globalThis.fetch=original}
});
