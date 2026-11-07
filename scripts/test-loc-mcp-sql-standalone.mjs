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
  or:['(title.contains."時間長河",content.contains."時間長河")'],
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
  denied({...SEARCH,or:['(title.contains."test",content.contains."different")']});
  denied({...SEARCH,or:['(title.contains."test",content.contains."test",uid.eq.Ab12Cd34)']});
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
  const driver=readFileSync(new URL('../supabase/functions/loc-kysely/drivers.ts',import.meta.url),'utf8');
  assert.match(driver,/kysely-database-drivers\.ts/);
  assert.doesNotMatch(driver,/class|new Kysely/);
});
