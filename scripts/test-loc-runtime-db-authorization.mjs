import test from 'node:test';
import assert from 'node:assert/strict';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';
const url='postgresql://app:dummy@127.0.0.1:5432/loc';
const env={LOC_MCP_DB_ALIAS:'primary',LOC_DB_CONNECTIONS_JSON:JSON.stringify({
 primary:{engine:'postgres',url,tls:false},
 secondary:{engine:'postgres',url,tls:false},
 other:{engine:'mysql',url:'mysql://app:dummy@127.0.0.1:3306/loc'}
})};
test('server-selected Kysely aliases preserve one-pool identity',async()=>{
 const result=await directMcpKysely(env);
 assert.equal(result.engine,'postgres');
 assert.equal(result.namespace,'silver');
 assert.equal(await directMcpKysely(env),result);
 assert.equal((await directMcpKysely(env,'secondary')).engine,'postgres');
 assert.equal((await directMcpKysely(env,'other')).engine,'mysql');
});
test('invalid SQL aliases fail closed',async()=>{
 await assert.rejects(directMcpKysely(env,'not/allowed'),/Invalid verified database alias/);
 await assert.rejects(directMcpKysely(env,'missing'),/alias does not exist/);
 await assert.rejects(directMcpKysely({LOC_DB_CONNECTIONS_JSON:'{}'}),/alias is not configured/);
});
test('browser parameters cannot select backend connection',async()=>{
 await assert.rejects(directMcpKysely({...env,
  LOC_MCP_DB_ALIAS:'',LOC_CONTROL_DB_ALIAS:''}),/alias is not configured/);
});
