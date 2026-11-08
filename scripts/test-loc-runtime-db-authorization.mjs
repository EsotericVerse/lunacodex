import test from 'node:test';
import assert from 'node:assert/strict';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';

const url='postgresql://app:dummy@127.0.0.1:5432/loc';
const env={LOC_MCP_DB_ALIAS:'primary',LOC_DB_CONNECTIONS_JSON:JSON.stringify({
 primary:{engine:'postgres',url,tls:false},
 secondary:{engine:'postgres',url,tls:false},
 wrong:{engine:'mysql',url:'mysql://app:dummy@127.0.0.1:3306/loc'}
})};

test('direct native Kysely opens only server-selected aliases',()=>{
 const result=directMcpKysely(env);
 assert.equal(result.engine,'postgres');
 assert.equal(result.namespace,'silver');
 assert.ok(result.db);
 assert.equal(directMcpKysely(env),result,'same environment reuses the pool');
 assert.equal(directMcpKysely(env,'secondary').engine,'postgres');
});

test('invalid or nonexistent SQL aliases fail closed before opening a connection',()=>{
 assert.throws(()=>directMcpKysely(env,'not/allowed'),/Invalid verified database alias/);
 assert.throws(()=>directMcpKysely(env,'missing'),/alias does not exist/);
 assert.throws(()=>directMcpKysely(env,'wrong'),/native mysql driver/);
 assert.throws(()=>directMcpKysely({LOC_DB_CONNECTIONS_JSON:'{}'}),/alias is not configured/);
});

test('browser credentials and URLs cannot select the server driver',()=>{
 const fromBrowser={...env,LOC_MCP_DB_ALIAS:'',LOC_CONTROL_DB_ALIAS:''};
 assert.throws(()=>directMcpKysely(fromBrowser),/alias is not configured/);
});
