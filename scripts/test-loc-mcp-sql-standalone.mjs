import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePublicMcpQuery} from '../app/loc/mcp/public-sql-gate.mjs';
import {searchMemory,readMemory} from '../app/loc/mcp/galaxy-read.mjs';

const PUBLISHED=['lo3rwang','lrunes'];
const SEARCH={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
  operation:'select',target:'configured',user_requested:true,
  columns:['uid','title','date','createtime'],
  filters:[{column:'search',operator:'eq',value:true}],
  or:['title.contains."時間長河",content.contains."時間長河"'],
  orders:[{column:'date',ascending:false},{column:'createtime',ascending:false}],
  limit:10,offset:0};
const READ={kind:'query',schema:'silver',table:'lrunes_galaxy',
  operation:'select',target:'configured',
  columns:['uid','title','content','date','createtime','site','url'],
  filters:[{column:'uid',operator:'eq',value:'Ab12Cd34'},
    {column:'list',operator:'eq',value:true}],limit:1,offset:0};
const denied=body=>assert.throws(
  ()=>validatePublicMcpQuery(body,PUBLISHED),/public MCP|not published|bounded public/i);

test('independent SQL Gateway accepts exactly the published read/search shapes',()=>{
  assert.equal(validatePublicMcpQuery(SEARCH,PUBLISHED),SEARCH);
  assert.equal(validatePublicMcpQuery(READ,PUBLISHED),READ);
});
test('public search requires an explicit human-requested flag even at SQL boundary',()=>{
  denied({...SEARCH,user_requested:undefined});
  denied({...SEARCH,user_requested:false});
  denied({...SEARCH,user_requested:'true'});
  denied({...READ,user_requested:true});
});
test('private, unpublished and arbitrary SQL scopes cannot be accessed anonymously',()=>{
  for(const table of ['admin_galaxy','loc_galaxy','lo3rwang_anchor','api_manage',
    'lo3rwang_galaxy;delete from galaxy'])
    denied({...SEARCH,table});
  denied({...SEARCH,target:'backup'});
  denied({...SEARCH,operation:'update'});
  denied({...SEARCH,schema:'api'});
  denied({...SEARCH,kind:'mcp-read'});
  denied({...SEARCH,connection_alias:'other'});
});
test('public article content cannot be returned through the search/list-summary projection',()=>{
  denied({...SEARCH,columns:['uid','title','content','date','createtime']});
  denied({...SEARCH,filters:[]});
  denied({...SEARCH,filters:[{column:'search',operator:'eq',value:false}]});
  denied({...SEARCH,or:['title.contains."test",content.contains."different"']});
  denied({...SEARCH,or:['title.contains."test",content.contains."test",uid.eq.Ab12Cd34)']});
  denied({...SEARCH,limit:21});
  denied({...SEARCH,offset:501});
});
test('full article read requires exact UID and list=true, never arbitrary filters',()=>{
  denied({...READ,filters:[READ.filters[0]]});
  denied({...READ,filters:[READ.filters[0],{column:'list',operator:'eq',value:false}]});
  denied({...READ,filters:[{column:'uid',operator:'eq',value:'%'},
    READ.filters[1]]});
  denied({...READ,columns:['*']});
  denied({...READ,limit:20});
});
test('public search and UID clients emit the same strict gateway contract',async()=>{
  const calls=[];
  const fetcher=async(_url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    validatePublicMcpQuery(body,PUBLISHED);
    return Response.json({data:[]});
  };
  const env={LOC_MCP_SQL_GATEWAY_URL:'https://sql.example.org/v1/sql'};
  await searchMemory({scopeid:'lo3rwang',query:'時間長河',user_requested:true},env,fetcher);
  await readMemory({scopeid:'lrunes',uid:'Ab12Cd34'},env,fetcher);
  assert.equal(calls.length,2);
  assert.equal(calls[0].user_requested,true);
  assert.equal(calls[1].user_requested,undefined);
});
test('public Kysely row gate rejects private MCP/GitHub sites even with wrong Boolean flags',()=>{
  const code=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  assert.match(code,/PRIVATE_SITES=[\s\S]*?'mcp','github'/);
  assert.match(code,/\.where\('search','=',true\)/);
  assert.match(code,/lower/);
});
test('portable SQL entry uses LOC delegations, no vendor Function or database API transport',()=>{
  const code=readFileSync(new URL('../services/loc-mcp-sql/main.ts',import.meta.url),'utf8');
  assert.match(code,/verifyDelegationBoundary\(/);
  assert.match(code,/executePortableMcp\(trx,body,claims/);
  assert.match(code,/validatePublicMcpQuery\(body,PUBLISHED\)/);
  assert.doesNotMatch(code,/supabase\.co|\/functions\/v1\/|\/rest\/v1\//);
  assert.match(code,/provider:'custom'/);
  // The standalone service must reuse the one portable Kysely driver.
  // The old supabase/functions implementation has been retired entirely.
  const driver=readFileSync(new URL('../app/loc/providers/kysely-database-drivers.ts',import.meta.url),'utf8');
  assert.match(code,/import \{databaseForTarget\} from '..\/..\/app\/loc\/providers\/kysely-database-drivers\.ts'/);
  for(const dialect of ['PostgresDialect','MysqlDialect','MssqlDialect'])
    assert.match(driver,new RegExp(dialect));
  assert.match(driver,/export async function databaseForTarget/);
  assert.doesNotMatch(code,/new Kysely\(/);
});

test('MCP SQL selects its own trusted alias or the existing LOC control alias',()=>{
  const code=readFileSync(new URL('../services/loc-mcp-sql/main.ts',import.meta.url),'utf8');
  assert.match(code,/Deno\.env\.get\('LOC_MCP_DB_ALIAS'\)\|\|/);
  assert.match(code,/Deno\.env\.get\('LOC_CONTROL_DB_ALIAS'\)\|\|'mcp_main'/);
  assert.match(code,/Deno\.env\.get\('LOC_CONTROL_DB_ENGINE'\)\|\|'postgres'/);
  assert.match(code,/profile\.engine!==engine/);
  assert.match(code,/typeof profile\.url!=='string'/);
});


// Exercise the real Cloudflare entry in Node without a Container deployment.
// Only the platform DurableObject base is substituted; routing remains intact.
async function loadMcpIngress(){
  const source=readFileSync(
    new URL('../services/loc-mcp-sql/cloudflare-worker.mjs',import.meta.url),'utf8')
    .replace("import {DurableObject} from 'cloudflare:workers';",
      'class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}');
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}

test('MCP Worker allows only LOC preflight without starting the container',async()=>{
  const {default:worker}=await loadMcpIngress();
  const url='https://mcp.lo3rwang.cc/v1/sql';
  const accepted=await worker.fetch(new Request(url,{method:'OPTIONS',
    headers:{origin:'https://loc.lo3rwang.cc'}}),{});
  assert.equal(accepted.status,204);
  assert.equal(accepted.headers.get('access-control-allow-origin'),
    'https://loc.lo3rwang.cc');
  const denied=await worker.fetch(new Request(url,{method:'OPTIONS',
    headers:{origin:'https://untrusted.example'}}),{});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('access-control-allow-origin'),null);
});

test('MCP Worker forwards a trusted shared control database without MCP-only vars',async()=>{
  const {default:worker}=await loadMcpIngress();
  let forwarded=null;
  const env={LOC_DB_CONNECTIONS_JSON:JSON.stringify({loc_main:{
    engine:'postgres',url:'postgresql://test.invalid/loc'}}),
    LOC_CONTROL_DB_ALIAS:'loc_main',LOC_CONTROL_DB_ENGINE:'postgres',
    LOC_MCP_SQL_CONTAINER:{getByName(name){
      assert.equal(name,'mcp-main');
      return {fetch:async req=>{forwarded=req;return Response.json({data:[]});}};
    }}};
  const url='https://mcp.lo3rwang.cc/v1/sql';
  const request=new Request(url,{method:'POST',headers:{
    authorization:'Bearer signed.loc.delegation',
    origin:'https://loc.lo3rwang.cc'
  },body:'{"kind":"mcp-read"}'});
  const response=await worker.fetch(request,env);
  assert.equal(response.status,200);
  assert.equal(forwarded.headers.get('authorization'),'Bearer signed.loc.delegation');
  assert.equal(await forwarded.text(),'{"kind":"mcp-read"}');
  const missing=await worker.fetch(new Request(url,{method:'POST',
    headers:{origin:'https://loc.lo3rwang.cc'}}),{});
  assert.equal(missing.status,503);
  assert.equal(missing.headers.get('access-control-allow-origin'),
    'https://loc.lo3rwang.cc');
  const config=JSON.parse(readFileSync(
    new URL('../services/loc-mcp-sql/wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.vars.LOC_MCP_DB_ALIAS,undefined);
  assert.equal(config.vars.LOC_MCP_DB_ENGINE,undefined);
});

test('MCP Container receives LOC control alias and Authority service credential',async()=>{
  const {LocMcpSqlContainer}=await loadMcpIngress();
  let started=null;
  const container={running:false,images:{base:'local-image'},
    start(opts){started=opts;this.running=true;},
    async setInactivityTimeout(){},
    getTcpPort(){return {fetch:async()=>new Response(null,{status:204})};}};
  const env={LOC_DB_CONNECTIONS_JSON:'{"loc_main":{"engine":"postgres","url":"test"}}',
    LOC_CONTROL_DB_ALIAS:'loc_main',LOC_CONTROL_DB_ENGINE:'postgres',
    LOC_SQL_GATEWAY_SERVICE_KEY:'s'.repeat(43)};
  const instance=new LocMcpSqlContainer({container},env);
  await instance.ensureReady();
  assert.equal(started.env.LOC_CONTROL_DB_ALIAS,'loc_main');
  assert.equal(started.env.LOC_CONTROL_DB_ENGINE,'postgres');
  assert.equal(started.env.LOC_SQL_GATEWAY_SERVICE_KEY,env.LOC_SQL_GATEWAY_SERVICE_KEY);
  assert.equal(started.env.LOC_MCP_DB_ALIAS,undefined);
});
