import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {issueDelegation} from '../app/loc/auth/delegation-contract.mjs';
import {handleNativeLocOperation} from '../app/loc/mcp/native-operations.mjs';

// Admin UPDATE/DELETE on the two fixed ZModel control relations
// (api.manage / silver.loc) must run through the REAL ZenStack+PolicyPlugin
// writer (zenstack/policy-runtime.mjs withFixedPolicyWrite), on the SAME
// trusted dialect/pool as directMcpKysely -- no second connection, no SQL
// Gateway. This exercises that end to end with a DummyDriver-backed fake
// Postgres dialect, the same pattern as scripts/test-native-public-content.mjs.
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ORIGIN='https://loc.lo3rwang.cc';
const b64=value=>Buffer.from(value instanceof Uint8Array?value:
  typeof value==='string'?value:JSON.stringify(value)).toString('base64url');

function fixedModelDialect({numAffectedRows=1n}={}){
  const executed=[];
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
    connection.executeQuery=async compiled=>{
      executed.push(compiled);
      return {rows:[],numAffectedRows};
    };
    return connection;
  };
  return {executed,dialect:{
    createDriver:()=>driver,createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  }};
}

async function signedDelegation(pair,kid,claims){
  const header=b64({alg:'RS256',typ:'JWT',kid});
  const payload=b64(claims);
  const digest=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    pair.privateKey,new TextEncoder().encode(header+'.'+payload)));
  return header+'.'+payload+'.'+b64(digest);
}
async function ownerDelegation(now,grants){
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
    modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
  },true,['sign','verify']);
  const kid='managed-write-test-'+Math.random().toString(36).slice(2);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),
    use:'sig',alg:'RS256',kid};
  const claims=issueDelegation({sub:'loc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    email:'sopa2306@gmail.com',grants,audience:'sql',sid:'managed-write-session',now});
  const token=await signedDelegation(pair,kid,claims);
  return {token,fetchImpl:async()=>Response.json({keys:[jwk]})};
}
const request=(body,token)=>new Request(ORIGIN+'/api/loc-native',{
  method:'POST',headers:{'content-type':'application/json',
    ...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)
});

test('A signed global:manage delegation updates api.manage through the real PolicyPlugin writer',async()=>{
  const now=Math.floor(Date.now()/1000);
  const {token,fetchImpl}=await ownerDelegation(now,['global:manage']);
  const {executed,dialect}=fixedModelDialect({numAffectedRows:1n});
  const body={kind:'managed-write',scopeid:'',payload:{
    p_table:'api.manage',p_operation:'update',
    p_values:{manage_role:'admin'},
    p_filters:[{column:'id',operator:'eq',value:'lo3rwang'}]
  }};
  const response=await handleNativeLocOperation(request(body,token),{},{
    fetchImpl,database:async()=>({engine:'postgres',dialect,db:{}})
  });
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{data:{count:1}});
  assert.equal(executed.length,1);
  assert.match(executed[0].sql,/update "api"\."manage"/i);
  assert.match(executed[0].sql,/where "id" = /i);
});

test('Managed write is refused without a global:manage grant',async()=>{
  const now=Math.floor(Date.now()/1000);
  const {token,fetchImpl}=await ownerDelegation(now,['lo3rwang:write']);
  const {executed,dialect}=fixedModelDialect();
  const body={kind:'managed-write',scopeid:'',payload:{
    p_table:'api.manage',p_operation:'update',
    p_values:{manage_role:'admin'},
    p_filters:[{column:'id',operator:'eq',value:'lo3rwang'}]
  }};
  const response=await handleNativeLocOperation(request(body,token),{},{
    fetchImpl,database:async()=>({engine:'postgres',dialect,db:{}})
  });
  assert.equal(response.status,403);
  assert.equal(executed.length,0,'no SQL must run when the policy gate refuses');
});

test('Managed write rejects any table outside api.manage / silver.loc',async()=>{
  const now=Math.floor(Date.now()/1000);
  const {token,fetchImpl}=await ownerDelegation(now,['global:manage']);
  const {executed,dialect}=fixedModelDialect();
  const body={kind:'managed-write',scopeid:'',payload:{
    p_table:'silver.lo3rwang',p_operation:'update',
    p_values:{display_name:'hijacked'},
    p_filters:[{column:'id',operator:'eq',value:'lo3rwang'}]
  }};
  const response=await handleNativeLocOperation(request(body,token),{},{
    fetchImpl,database:async()=>({engine:'postgres',dialect,db:{}})
  });
  assert.equal(response.status,403);
  assert.equal(executed.length,0);
});

test('Managed write rejects an unfiltered delete before any SQL runs',async()=>{
  const now=Math.floor(Date.now()/1000);
  const {token,fetchImpl}=await ownerDelegation(now,['global:manage']);
  const {executed,dialect}=fixedModelDialect();
  const body={kind:'managed-write',scopeid:'',payload:{
    p_table:'silver.loc',p_operation:'delete',p_filters:[]
  }};
  const response=await handleNativeLocOperation(request(body,token),{},{
    fetchImpl,database:async()=>({engine:'postgres',dialect,db:{}})
  });
  assert.equal(response.status,400);
  assert.equal(executed.length,0);
});

test('The website host now accepts managed-write but still rejects other MCP kinds',async()=>{
  const forbid=async()=>{throw Error('Unauthorized request made a network/database call');};
  const rejected=await handleNativeLocOperation(
    request({kind:'mcp-read',scopeid:'lo3rwang',uid:'Ab12Cd34',site:'mcp'},''),
    {},{fetchImpl:forbid,database:forbid});
  assert.equal(rejected.status,404,'the website host must still only expose short-import and managed-write');
});
