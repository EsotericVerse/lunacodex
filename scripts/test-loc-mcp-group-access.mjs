import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scopeGroupRequest} from '../app/loc/mcp/scope-group-client.mjs';
const root='https://auth.lo3rwang.cc';
function service(response={groupid:'loc',members:['lo3rwang','lrunes'],grants:[]}){
  const requests=[];
  const fetchImpl=async (url,opts)=>{
    requests.push({url:String(url),opts});
    return String(url)==='/recovery/config.json'?Response.json({controlUrl:root}):Response.json(response);
  };
  return {fetchImpl,requests};
}
test('group list uses authenticated endpoint and no credential in URL',async()=>{
  const {fetchImpl,requests}=service();
  const result=await scopeGroupRequest({groupid:'loc',token:'signed-token',fetchImpl});
  assert.deepEqual(result.members,['lo3rwang','lrunes']);
  assert.equal(requests[1].url,root+'/v1/mcp/group/loc/grants');
  assert.equal(requests[1].opts.headers.authorization,'Bearer signed-token');
  assert.equal(requests[1].opts.method,'GET');
});
test('group grants bounded rights without leaking authorization to URL',async()=>{
  const {fetchImpl,requests}=service();
  await scopeGroupRequest({groupid:'loc',kind:'grant',scopeid:'lrunes',subject:'user_A1',
    actions:['read','configure'],days:365,token:'signed-token',fetchImpl});
  const req=requests[1],payload=JSON.parse(req.opts.body);
  assert.equal(req.opts.method,'PUT');
  assert.equal(req.url,root+'/v1/mcp/group/loc/grant');
  assert.deepEqual(payload.actions,['read','configure']);
  assert.equal(payload.scope,'lrunes');
  assert.ok(payload.expires_at>Date.now());
});
test('revoke targets a selected Clerk principal and Scope',async()=>{
  const {fetchImpl,requests}=service();
  await scopeGroupRequest({groupid:'loc',kind:'revoke',scopeid:'lrunes',subject:'user_2',
    token:'signed-token',fetchImpl});
  assert.equal(requests[1].opts.method,'POST');
  assert.deepEqual(JSON.parse(requests[1].opts.body),{scope:'lrunes',subject:'user_2'});
});
test('invalid group, subject or permissions cannot issue network calls',async()=>{
  const {fetchImpl,requests}=service();
  await assert.rejects(scopeGroupRequest({groupid:'../loc',token:'signed-token',fetchImpl}),/Invalid Group/);
  await assert.rejects(scopeGroupRequest({groupid:'loc',kind:'grant',scopeid:'lrunes',
    subject:'user_1',actions:['admin'],token:'signed-token',fetchImpl}),/Invalid Group/);
  assert.equal(requests.length,0);
});
test('joining an existing Scope uses the consent-enforcing Group endpoint',async()=>{
  const {fetchImpl,requests}=service();
  await scopeGroupRequest({groupid:'loc',kind:'join',scopeid:'another',token:'signed-token',fetchImpl});
  assert.equal(requests[1].url,root+'/v1/mcp/group/loc/scope/another');
  assert.equal(requests[1].opts.method,'PUT');
});
test('HTTP 403 denies group grant visibility',async()=>{
  const fetchImpl=async url=>String(url)==='/recovery/config.json'?
    Response.json({controlUrl:root}):new Response('{}',{status:403});
  await assert.rejects(scopeGroupRequest({groupid:'loc',token:'signed-token',fetchImpl}),
    /permission required/);
});

test('Group Category accepts only member Scope and exact four-character Class UID',async()=>{
  const {fetchImpl,requests}=service();
  await scopeGroupRequest({groupid:'loc',kind:'categoryAdd',scopeid:'lo3rwang',
    classUid:'Ab1Z',token:'signed-token',fetchImpl});
  const req=requests[1];
  assert.equal(req.url,root+'/v1/mcp/group/loc/category');
  assert.equal(req.opts.method,'PUT');
  assert.deepEqual(JSON.parse(req.opts.body),{scopeid:'lo3rwang',class_uid:'Ab1Z'});
  await scopeGroupRequest({groupid:'loc',kind:'categoryRemove',scopeid:'lo3rwang',
    classUid:'Ab1Z',token:'signed-token',fetchImpl});
  assert.equal(requests[3].opts.method,'POST');
  for(const uid of ['Ab1','12345','group',''])await assert.rejects(
    scopeGroupRequest({groupid:'loc',kind:'categoryAdd',scopeid:'lo3rwang',
      classUid:uid,token:'signed-token',fetchImpl}),/Invalid keyword Category/);
  assert.equal(requests.length,4);
});

test('Group Category is scoped to the registered member and server-side Group manager',()=>{
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(worker,/allowed\(groupid,'manage'\)/);
  assert.match(worker,/putMcpGroupKeywordCategory/);
  assert.match(worker,/removeMcpGroupKeywordCategory/);
  assert.match(worker,/hashKeywordCategory\(valid\.scopeid,valid\.class\)/);
});

test('public Class import is verified by authority, not solely by UI',async()=>{
  const {assertPublicKeywordClass}=await import('../workers/loc-authority/keyword-categories.mjs');
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts});
    return Response.json([{scopeId:'lo3rwang',classUid:'A1b2',name:'音樂'},
      {scopeId:'lo3rwang',classUid:'G3rp',name:'Other'}]);
  };
  await assertPublicKeywordClass('lo3rwang','A1b2',{fetchImpl});
  await assert.rejects(assertPublicKeywordClass('lo3rwang','item',{fetchImpl}),/public Class UID/);
  assert.equal(calls[0].opts.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body),{p_scope_id:'lo3rwang'});
  assert.equal(calls[0].opts.headers['accept-profile'],'silver');
  assert.equal(calls[0].opts.headers['content-profile'],'silver');
  assert.equal(calls[0].url.endsWith('/rest/v1/rpc/read_shared_keyword_classes'),true);
});
test('authority fail-closes if public Class RPC is unavailable',async()=>{
  const {assertPublicKeywordClass}=await import('../workers/loc-authority/keyword-categories.mjs');
  const fetchImpl=async()=>new Response('unavailable',{status:503});
  await assert.rejects(assertPublicKeywordClass('lo3rwang','A1b2',{fetchImpl}),/unavailable/);
});
test('Scope Group UI lists only publicly shared Class identifiers',()=>{
  const src=readFileSync(new URL('../app/loc/ScopeGroupAccessPanel.jsx',import.meta.url),'utf8');
  assert.match(src,/read_shared_keyword_classes/);
  assert.match(src,/publicClasses\.map\(row=><option/);
  assert.match(src,/row\.scopeId===scope/);
  assert.doesNotMatch(src,/categoryUid\} maxLength=/);
  const authority=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(authority,/await assertPublicKeywordClass\(valid\.scopeid,valid\.class/);
});
