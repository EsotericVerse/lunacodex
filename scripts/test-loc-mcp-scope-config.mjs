import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeConfigRequest} from '../app/loc/mcp/scope-config-client.mjs';

const root='https://auth.lo3rwang.cc';
function mockFetch(result={scopeid:'lrunes',configured:true,endpoint:'https://db.example.org/rest/v1',schema:'public',table:'lrunes_galaxy'}) {
  const calls=[];
  const fetchImpl=async (url,init={})=>{
    calls.push({url:String(url),init});
    if(String(url)==='/recovery/config.json')return Response.json({controlUrl:root});
    return Response.json(result);
  };
  return {fetchImpl,calls};
}
test('Get an existing Scope uses verified LOC Auth OAuth token, never sends DB credentials',async()=>{
  const {fetchImpl,calls}=mockFetch();
  const result=await scopeConfigRequest({scopeid:'lrunes',token:'loc-oauth-token',fetchImpl});
  assert.equal(result.table,'lrunes_galaxy');
  assert.equal(calls.length,2);
  assert.equal(calls[1].url,root+'/v1/mcp/scope/lrunes');
  assert.equal(calls[1].init.method,'GET');
  assert.equal(calls[1].init.headers.authorization,'Bearer loc-oauth-token');
  assert.equal(calls[1].init.credentials,'omit');
});
test('Credential submits only to the HTTPS Authority body, not URL, analytics or Galaxy',async()=>{
  const {fetchImpl,calls}=mockFetch();
  const key='sensitive-mcp-api-key';
  await scopeConfigRequest({scopeid:'lrunes',token:'loc-oauth-token',fetchImpl,
    values:{endpoint:'https://db.example.org/rest/v1',schema:'silver',table:'lrunes_galaxy',api_key:key}});
  assert.equal(calls[1].init.method,'PUT');
  assert.equal(calls[1].url,root+'/v1/mcp/scope/lrunes');
  assert.equal(JSON.parse(calls[1].init.body).api_key,key);
  assert.ok(!calls.map(x=>x.url).join(' ').includes(key));
});
test('Rejects missing identity and scope injection before issuing a network request',async()=>{
  const {fetchImpl,calls}=mockFetch();
  await assert.rejects(scopeConfigRequest({scopeid:'lrunes',token:'',fetchImpl}),/LOC Auth/);
  await assert.rejects(scopeConfigRequest({scopeid:'../loc',token:'loc-oauth-token',fetchImpl}),/Scope/);
  assert.equal(calls.length,0);
});
test('Untrusted or non-HTTPS Authority origin is never sent the signed token',async()=>{
  const calls=[];
  const fetchImpl=async (url,init)=>{calls.push({url,init});return Response.json({controlUrl:'http://insecure.example.org'});};
  await assert.rejects(scopeConfigRequest({scopeid:'lrunes',token:'loc-oauth-token',fetchImpl}),/HTTPS/);
  assert.equal(calls.length,1);
});
test('HTTP 403 is surfaced as a Scope Group permission issue',async()=>{
  const fetchImpl=async url=>String(url)==='/recovery/config.json'?
    Response.json({controlUrl:root}):new Response('{}',{status:403});
  await assert.rejects(scopeConfigRequest({scopeid:'lrunes',token:'loc-oauth-token',fetchImpl}),/Scope Group/);
});
