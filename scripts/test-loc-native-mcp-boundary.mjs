import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {issueDelegation} from '../app/loc/auth/delegation-contract.mjs';
import {handleNativeLocOperation} from '../app/loc/mcp/native-operations.mjs';
import {handleNativePublicClasses} from '../app/loc/mcp/public-classes.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ORIGIN='https://mcp.lo3rwang.cc';
const body={kind:'mcp-read',scopeid:'lo3rwang',uid:'Ab12Cd34',site:'mcp'};
const b64=value=>Buffer.from(value instanceof Uint8Array?value:
  typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
const request=(value=body,token='',host=ORIGIN)=>new Request(host+'/api/loc-native',{
  method:'POST',headers:{'content-type':'application/json',
    ...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(value)
});
const forbid=async()=>{throw Error('Unauthorized request made a network/database call');};
const never=async()=>{throw Error('Unauthorized request opened a database');};

test('Native business route rejects arbitrary SQL/query input before access',async()=>{
  const rejected=await handleNativeLocOperation(request({
    kind:'query',scopeid:'lo3rwang',sql:'select * from silver.lo3rwang_galaxy'
  }),{}, {fetchImpl:forbid,database:never});
  assert.equal(rejected.status,400);
  const missing=await handleNativeLocOperation(request(),{},
    {fetchImpl:forbid,database:never});
  assert.equal(missing.status,401);
  const wrongHost=await handleNativeLocOperation(request(body,'', 'https://evil.example'),{},
    {fetchImpl:forbid,database:never});
  assert.equal(wrongHost.status,404);
});
test('Signed LOC MCP Scope read is executed in the existing native Kysely app',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
    modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
  },true,['sign','verify']);
  const kid='native-test-unique-2026';
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),
    use:'sig',alg:'RS256',kid};
  const now=Math.floor(Date.now()/1000);
  const claims=issueDelegation({sub:'loc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    grants:['lo3rwang:read'],audience:'mcp',sid:'test-session',now,
    seconds:300,targetId:'loc_main'});
  const header=b64({alg:'RS256',typ:'JWT',kid});
  const payload=b64(claims);
  const digest=new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',pair.privateKey,
    new TextEncoder().encode(header+'.'+payload)));
  const token=header+'.'+payload+'.'+b64(digest);
  let selected='',reads=0;
  const builder={
    select(){return this;},where(){return this;},limit(){return this;},
    async execute(){reads++;return [{
      uid:'Ab12Cd34',site:'mcp',title:'Verified conversation',
      content:'Private text',createtime:'2026-11-08T00:00:00Z'}];}
  };
  const options={fetchImpl:async()=>Response.json({keys:[jwk]}),
    database:async(_env,alias)=>{
      selected=alias;
      return {engine:'postgres',namespace:'silver',
        db:{selectFrom:()=>builder}};
    }};
  const valid=await handleNativeLocOperation(request(body,token),{},options);
  assert.equal(valid.status,200);
  assert.equal((await valid.json()).data[0].title,'Verified conversation');
  assert.equal(selected,'loc_main');
  assert.equal(reads,1);
  const denied=await handleNativeLocOperation(request({
    ...body,scopeid:'lrunes'
  },token),{},options);
  assert.equal(denied.status,403);
  assert.equal(reads,1,'unauthorized Scope must never query Galaxy');
});
test('Public class directory emits only class_shares=true and no arbitrary SQL',async()=>{
  let read=0;
  const builder={
    select(){return this;},where(){return this;},
    limit(){return this;},orderBy(){return this;},
    async executeTakeFirst(){
      read++;return {keyword_meta:{class_shares:{A1b2:true,A2b3:false}}};
    },
    async execute(){
      read++;return [{uid:'A1b2',title:'Visible'},{uid:'A2b3',title:'Private'}];
    }
  };
  const selected=[];
  const handlerOptions={database:async()=>({engine:'postgres',namespace:'silver',
    db:{selectFrom:relation=>{selected.push(relation);return builder;}}})};
  const valid=await handleNativePublicClasses(new Request(ORIGIN+
    '/api/loc-public-classes?scopeid=lo3rwang'),{},handlerOptions);
  assert.equal(valid.status,200);
  assert.deepEqual((await valid.json()).data,[{
    scopeId:'lo3rwang',classUid:'A1b2',name:'Visible'
  }]);
  assert.equal(read,2);
  assert.deepEqual(selected,['silver.lo3rwang','silver.lo3rwang_anchor']);
  const bad=await handleNativePublicClasses(new Request(ORIGIN+
    '/api/loc-public-classes?scopeid=../loc'),{},handlerOptions);
  assert.equal(bad.status,400);
});
test('LOC Auth source has no gateway forwarding or credential return endpoint',()=>{
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  const oauth=readFileSync(new URL('../workers/loc-authority/native-oauth.mjs',import.meta.url),'utf8');
  const classes=readFileSync(new URL('../workers/loc-authority/keyword-categories.mjs',import.meta.url),'utf8');
  for(const file of [worker,oauth,classes])
    assert.doesNotMatch(file,/LOC_SQL_GATEWAY_URL|LOC_MCP_SQL_GATEWAY_URL|\/v1\/sql|mcpSqlRequest|mcpSqlGateway/);
  assert.match(worker,/LOC_NATIVE_APPLICATION/);
  assert.match(oauth,/\/api\/loc-native/);
  assert.match(classes,/\/api\/loc-public-classes/);
});
