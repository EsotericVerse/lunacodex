import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {privateGalaxyLink} from '../app/loc/mcp/private-galaxy.mjs';

const SUBJECT='loc_'+'A'.repeat(40),TOKEN='eyJ.mock.oauth';
function fixture(rows=[{uid:'Ab12Cd34',title:'Original conversation',content:'abcdefghij',
  site:'mcp',date:'2026-11-01',createtime:'2026-11-01T00:00:00Z'}]){
 const queries=[],aliases=[],requests=[];
 const query={
  select(columns){queries.push(['select',columns]);return this;},
  where(...items){queries.push(['where',...items]);return this;},
  orderBy(...items){queries.push(['orderBy',...items]);return this;},
  limit(n){queries.push(['limit',n]);return this;},
  async execute(){queries.push(['execute']);return rows;}
 };
 const env={locDirectDatabase:async(alias='')=>{
  aliases.push(alias);
  return {engine:'postgres',namespace:'silver',
   db:{selectFrom(table){queries.push(['table',table]);return query;}}};
 }};
 const fetcher=async(url,options)=>{
  requests.push({url:String(url),options});
  return Response.json({authorized:true,subject:SUBJECT,
    scopeid:'lo3rwang',action:'read',db_target:'verified_pg'});
 };
 return {env,fetcher,requests,queries,aliases};
}
test('private MCP read checks LOC Auth first and binds its selected alias to Kysely',async()=>{
 const f=fixture();
 const result=await privateGalaxyLink({action:'read',scopeid:'lo3rwang',
  uid:'Ab12Cd34',offset:3,max_chars:4},TOKEN,SUBJECT,f.env,f.fetcher);
 assert.equal(result.content,'defg');
 assert.equal(result.next_offset,7);
 assert.equal(f.requests.length,1);
 assert.match(f.requests[0].url,/\/v1\/mcp\/direct-permit\/lo3rwang\/read$/);
 assert.equal(f.requests[0].options.method,'GET');
 assert.equal(f.requests[0].options.headers.authorization,'Bearer '+TOKEN);
 assert.deepEqual(f.aliases,['verified_pg']);
 assert.ok(f.queries.some(q=>q[0]==='table'&&q[1]==='silver.lo3rwang_galaxy'));
 assert.ok(f.queries.some(q=>q[0]==='where'&&q[1]==='site'&&q[3]==='mcp'));
 assert.ok(f.queries.some(q=>q[0]==='where'&&q[1]==='uid'&&q[3]==='Ab12Cd34'));
});
test('private MCP search uses existing conversation-only Kysely and user-requested gate',async()=>{
 const f=fixture([{uid:'Ab12Cd34',title:'Original',createtime:'2026-11-01T00:00:00Z'}]);
 await assert.rejects(privateGalaxyLink({action:'search',scopeid:'lo3rwang',
  query:'時間定錨'},TOKEN,SUBJECT,f.env,f.fetcher),/明確要求/);
 assert.equal(f.requests.length,0);
 const result=await privateGalaxyLink({action:'search',scopeid:'lo3rwang',
  query:'時間定錨',user_requested:true,limit:5},TOKEN,SUBJECT,f.env,f.fetcher);
 assert.equal(result.results[0].uid,'Ab12Cd34');
 assert.ok(f.queries.some(q=>q[0]==='limit'&&q[1]===5));
});
test('Auth denial or subject mismatch rejects before touching database',async()=>{
 const f=fixture();
 await assert.rejects(privateGalaxyLink({action:'read',scopeid:'lo3rwang',
  uid:'Ab12Cd34'},TOKEN,SUBJECT,f.env,async()=>Response.json({},{
  status:403})),/Scope read permission denied/);
 await assert.rejects(privateGalaxyLink({action:'read',scopeid:'lo3rwang',
  uid:'Ab12Cd34'},TOKEN,SUBJECT,f.env,
  async()=>Response.json({authorized:true,subject:'loc_'+'B'.repeat(40),
   scopeid:'lo3rwang',action:'read'})),/authorization response/);
 assert.equal(f.queries.length,0);
});
test('PR search, invalid UIDs, invalid Scope and external URL fields cannot trigger direct SQL',async()=>{
 const f=fixture();
 for(const args of [
  {action:'read',scopeid:'lo3rwang',uid:'../../etc'},
  {action:'read',scopeid:'admin!',uid:'Ab12Cd34'},
  {action:'read',scopeid:'lo3rwang',uid:'Ab12Cd34',site:'github'},
  {action:'search',scopeid:'lo3rwang',query:'PR #1252',user_requested:true}
 ]){
  await assert.rejects(privateGalaxyLink(args,TOKEN,SUBJECT,f.env,f.fetcher));
 }
 assert.equal(f.requests.length,0);
 assert.equal(f.queries.length,0);
});
test('private read path contains no HTTP SQL Gateway or database credential forwarding',()=>{
 const source=readFileSync(new URL('../app/loc/mcp/private-galaxy.mjs',import.meta.url),'utf8');
 const auth=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/LOC_SQL_GATEWAY_URL|\/v1\/sql|sql_gateway|gatewayUrl/);
 assert.match(source,/executePortableMcp\(selected\.db,body/);
 assert.match(auth,/direct-permit/);
 assert.match(auth,/MCP Scope grant denied/);
});
