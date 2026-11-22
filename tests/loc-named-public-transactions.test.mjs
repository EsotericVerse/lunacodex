import test from 'node:test';
import assert from 'node:assert/strict';
import {handleNamedPublicTransaction} from '../app/loc/server/public-named-transactions.mjs';
import {handleLocSelfPermissions} from '../app/loc/permissions/loc-permissions-server.mjs';
import {LOC_OWNER_EMAIL} from '../app/loc/permissions/loc-business-grants.mjs';
import {parseGalaxyRecordTransaction,executeGalaxyRecordTransaction} from '../app/loc/model/galaxy-record-transactions.mjs';
import {galaxyAble} from '../app/loc/model/galaxy-able.mjs';
import {readFileSync} from 'node:fs';

const origin='https://loc.lo3rwang.cc';
const req=(body,path='/api/loc-public-query')=>new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify(body)});
const forbid=()=>{throw Error('Rejected contract must not open database')};

test('public SQL gateway shapes are rejected before any database connection',async()=>{
  for(const body of [
    {schema:'silver',table:'lo3rwang_galaxy',columns:['*'],filters:[]},
    {kind:'transaction',operation:'query',sql:'select * from api.manage'},
    {kind:'transaction',operation:'time-anchors',scope:'lo3rwang',
      mode:'public',table:'api.manage'},
    {kind:'transaction',operation:'time-anchors',scope:'lo3rwang',
      mode:'public',cursor:"' OR 1=1"},
    {kind:'transaction',operation:'action',name:'read_app_bootstrap',args:{}}
  ]){
    const response=await handleNamedPublicTransaction(req(body),{},{database:forbid});
    assert.equal(response.status,400);
  }
});

test('editor TimeAnchor read denies missing Session before SQL',async()=>{
  const response=await handleNamedPublicTransaction(req({
    kind:'transaction',operation:'time-anchors',scope:'lo3rwang',mode:'editor'
  }),{},{database:forbid,verifySession:async()=>{
    throw Object.assign(Error('Missing Session'),{httpStatus:401});
  }});
  assert.equal(response.status,401);
});

test('authorized TimeAnchor page reads exactly one repeatable-read transaction',async()=>{
  const used={transactions:0,tables:[],levels:[],limits:[]};
  const rows=[{uid:'AAAA0001',type:'date',title:'First',description:'',
    attr:{date:'2026-01-01'},invisible:false}];
  const query={select(){return this;},where(){return this;},
    orderBy(){return this;},limit(n){used.limits.push(n);return this},
    async execute(){return rows}};
  const trx={selectFrom(name){used.tables.push(name);return query}};
  const database=async()=>({engine:'postgres',namespace:'silver',
    db:{transaction(){used.transactions++;return {
      setIsolationLevel(level){used.levels.push(level);return this},
      async execute(fn){return fn(trx)}
    }},async destroy(){}},
    pool:{async end(){}}
  });
  const response=await handleNamedPublicTransaction(req({
    kind:'transaction',operation:'time-anchors',scope:'lo3rwang',
    mode:'editor',limit:50
  }),{},{database,verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data,rows);
  assert.equal(used.transactions,1);
  assert.deepEqual(used.levels,['repeatable read']);
  assert.deepEqual(used.tables,['silver.lo3rwang_anchor']);
  assert.deepEqual(used.limits,[51]);
});

test('permissions return only Session self-projection without SQL',async()=>{
  const response=await handleLocSelfPermissions(req({operation:'self'},
    '/api/loc-permissions'),{verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.ok(payload.grants.includes('global:manage'));
  assert.equal(payload.canManage,true);
  assert.equal(payload.connectionString,undefined);
  const cross=new Request(origin+'/api/loc-permissions',{method:'POST',
    headers:{origin:'https://evil.example'},body:'{"operation":"self"}'});
  const blocked=await handleLocSelfPermissions(cross,{
    verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(blocked.status,403);
});

test('MCP defaults are listable and nonextractable; all eight flags stay independent',()=>{
  const attrs=galaxyAble({site:'mcp'});
  assert.equal(Object.keys(attrs).length,8);
  assert.equal(attrs.list,true);
  assert.equal(attrs.extract,false);
  assert.equal(attrs.search,true);
  assert.equal(attrs.culture,true);
  assert.equal(galaxyAble({site:'mcp',list:false,extract:false}).list,false);
  assert.equal(galaxyAble({site:'mcp',list:true,extract:true}).extract,true);
});
test('public UID article detail has an enforced SQL list+extract predicate',async()=>{
  const seen=[];
  const query={select(){return this},where(...args){seen.push(args);return this},
    async execute(){return []}};
  const trx={selectFrom(table){assert.equal(table,'silver.lo3rwang_galaxy');return query}};
  const detail=parseGalaxyRecordTransaction({kind:'transaction',operation:'galaxy-records',
    scope:'lo3rwang',view:'detail',uids:['AAAA0001']});
  await executeGalaxyRecordTransaction(trx,detail);
  assert.ok(seen.some(args=>args[0]==='list'&&args[1]==='='&&args[2]===true));
  assert.ok(seen.some(args=>args[0]==='extract'&&args[1]==='='&&args[2]===true));
  const before=seen.length;
  await executeGalaxyRecordTransaction(trx,{...detail,view:'list'});
  assert.ok(!seen.slice(before).some(args=>args[0]==='extract'));
  seen.length=0;
  await executeGalaxyRecordTransaction(trx,{...detail,mode:'editor'});
  assert.ok(!seen.some(args=>args[0]==='extract'));
});
test('public reading protects content even with direct UID and no database RLS',()=>{
  const model=readFileSync(new URL('../app/loc/model/galaxy-record-transactions.mjs',
    import.meta.url),'utf8');
  const mcp=readFileSync(new URL('../app/loc/mcp/galaxy-read.mjs',
    import.meta.url),'utf8');
  assert.match(model,/query\.where\('extract','=',true\)/);
  assert.match(mcp,/\.where\('extract','=',true\)/);
  assert.doesNotMatch(mcp,/sql\`[^]*lower.*'mcp','github'/);
});
