import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Evaluate the exact source helper, not a copied implementation. The Worker
// module itself needs a Cloudflare Durable Object runtime to be imported.
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
const start=source.indexOf('function managedMcpGateway(env){');
const end=source.indexOf('const SCOPE_ID=',start);
assert.ok(start>=0&&end>start,'managed SQL Gateway contract missing');
const helpers=runInNewContext(source.slice(start,end)+'\n({managedMcpGateway,managedMcpHeaders})',{
  URL,MANAGED_SUPABASE_EDGE:'https://legacy.example/functions/v1/loc-kysely-clerk',
  MANAGED_PUBLISHABLE_KEY:'legacy-public-key',
  fail:(message,status)=>Object.assign(new Error(message),{status})
});

test('independent managed MCP Gateway removes provider API key',()=>{
  const env={LOC_MANAGED_SQL_GATEWAY_URL:'https://sql.lo3rwang.cc/v1/loc-kysely'};
  const result=helpers.managedMcpGateway(env);
  assert.equal(result.url,env.LOC_MANAGED_SQL_GATEWAY_URL);
  assert.equal(result.apikey,'');
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.managedMcpHeaders(env,'example-token'))),{
    authorization:'Bearer example-token','content-type':'application/json'
  });
});

test('legacy managed MCP endpoint stays available only when unconfigured',()=>{
  const result=helpers.managedMcpGateway({});
  assert.equal(result.url,'https://legacy.example/functions/v1/loc-kysely-clerk');
  assert.equal(result.apikey,'legacy-public-key');
  assert.equal(helpers.managedMcpHeaders({},'token').apikey,'legacy-public-key');
});

test('managed MCP Gateway rejects insecure and credential-bearing URLs',()=>{
  for(const endpoint of [
    'http://sql.example.com/v1/loc-kysely','https://user:pass@sql.example.com/v1',
    'https://sql.example.com/v1?token=secret','https://sql.example.com/v1#token',
    'https://localhost/v1','https://127.0.0.1/v1','https://foo.internal/v1',
    'https://sql.example.com/'
  ]){
    assert.throws(()=>helpers.managedMcpGateway({LOC_MANAGED_SQL_GATEWAY_URL:endpoint}),
      /Invalid LOC managed SQL Gateway URL/,endpoint);
  }
});

test('every managed MCP SQL operation uses the common gateway and headers',()=>{
  for(const name of ['managedMcpInsert','managedMcpAppend','managedMcpUpdatePr','managedMcpRead']){
    const start=source.indexOf('async function '+name+'(');
    assert.ok(start>=0,name+' missing');
    const end=source.indexOf('\n}',start);
    const code=source.slice(start,end+2);
    assert.match(code,/managedMcpGateway\(env\)\.url/);
    assert.match(code,/managedMcpHeaders\(env,oauthToken\)/);
    assert.doesNotMatch(code,/fetch\(MANAGED_SUPABASE_EDGE/);
  }
});
