import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';

const url='postgresql://app:password@127.0.0.1:5432/database';
const profile={engine:'postgres',url,tls:true};
const configured=()=>({LOC_MCP_DB_ALIAS:'control',
 LOC_DB_CONNECTIONS_JSON:JSON.stringify({control:profile})});

test('the existing MCP Pages runtime selects a trusted native SQL alias only',()=>{
 const env=configured();
 const first=directMcpKysely(env),second=directMcpKysely(env);
 assert.equal(first,second,'one pool per backend binding/profile');
 assert.equal(first.engine,'postgres');
 assert.equal(first.namespace,'silver');
 assert.equal(typeof first.db.selectFrom,'function');
 assert.deepEqual(Object.keys(first).sort(),['db','engine','namespace']);
});
test('no runtime SQL secret or an invalid alias fails closed',()=>{
 assert.throws(()=>directMcpKysely({}),/alias is not configured/);
 assert.throws(()=>directMcpKysely({...configured(),
   LOC_MCP_DB_ALIAS:'bad/alias'}),/alias is not configured/);
 assert.throws(()=>directMcpKysely({...configured(),
   LOC_DB_CONNECTIONS_JSON:'not-json'}),/invalid JSON/);
 assert.throws(()=>directMcpKysely({...configured(),
   LOC_DB_CONNECTIONS_JSON:'{}'}),/alias does not exist/);
});
test('dialect must match trusted profile, never caller-supplied SQL or API host',()=>{
 const env=configured();
 assert.throws(()=>directMcpKysely({...env,LOC_MCP_DB_ENGINE:'mssql'}),/engine mismatch/);
 assert.throws(()=>directMcpKysely({...env,LOC_DB_CONNECTIONS_JSON:
   JSON.stringify({control:{engine:'postgres',url:'https://example.com/rest/v1'}})}),/PostgreSQL connection URL/);
 for(const engine of ['mysql','mssql'])
  assert.throws(()=>directMcpKysely({...env,LOC_DB_CONNECTIONS_JSON:
   JSON.stringify({control:{engine,url}})}),/needs a native/);
});
test('MCP Pages routes bind in-process driver; never construct or forward SQL Gateway',()=>{
 for(const route of ['functions/index.js','functions/mcp.js']){
  const source=readFileSync(new URL('../'+route,import.meta.url),'utf8');
  assert.match(source,/locDirectDatabase:\(verifiedAlias=''\)=>directMcpKysely\(bindings,verifiedAlias\)/);
  assert.doesNotMatch(source,/LOC_SQL_GATEWAY_URL|\/v1\/sql/);
 }
});

test('LOC Auth verified DB target selects the matching trusted profile only',()=>{
 const env={...configured(),LOC_DB_CONNECTIONS_JSON:JSON.stringify({
  control:profile,office_pg:{...profile,url:'postgresql://other:pass@127.0.0.1:5433/office'}
 })};
 const selected=directMcpKysely(env,'office_pg');
 assert.equal(selected.engine,'postgres');
 assert.equal(directMcpKysely(env,'office_pg'),selected);
 assert.notEqual(selected,directMcpKysely(env),'authorized alias must not reuse the wrong pool');
 assert.throws(()=>directMcpKysely(env,'not_provisioned'),/alias does not exist/);
 assert.throws(()=>directMcpKysely(env,'bad/alias'),/Invalid verified database alias/);
});
