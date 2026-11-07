import test from 'node:test';
import assert from 'node:assert/strict';
import {searchMemory,readMemory} from '../app/loc/mcp/galaxy-read.mjs';

const ENV={LOC_MCP_SQL_GATEWAY_URL:'https://sql.lo3rwang.cc/v1/sql'};
function fakeFetch(rows){
 const history=[];
 const fetch=async(url,options)=>{
  history.push({url:String(url),options,request:JSON.parse(options.body)});
  return Response.json({data:rows});
 };
 return {fetch,history};
}
test('public Galaxy searches require a human user request and use Kysely contains',async()=>{
 const p=fakeFetch([{uid:'30D7AFD7',title:'LP26',date:'2026-11-01'}]);
 await assert.rejects(searchMemory({query:'LP26'},ENV,p.fetch),/使用者明確要求/);
 assert.equal(p.history.length,0);
 const result=await searchMemory({query:'LP26',user_requested:true,limit:10},ENV,p.fetch);
 assert.equal(result.results[0].uid,'30D7AFD7');
 const {url,request,options}=p.history[0];
 assert.equal(url,ENV.LOC_MCP_SQL_GATEWAY_URL);
 assert.equal(request.kind,'query');
 assert.equal(request.table,'lo3rwang_galaxy');
 assert.deepEqual(request.columns,['uid','title','date','createtime']);
 assert.deepEqual(request.filters,[{column:'search',operator:'eq',value:true}]);
 assert.deepEqual(request.or,['title.contains."LP26",content.contains."LP26"']);
 assert.equal(options.headers.authorization,undefined);
 assert.equal(options.headers.apikey,undefined);
 assert.equal(options.method,'POST');
});
test('public UID read preserves Base62 and the anonymous list visibility guard',async()=>{
 const p=fakeFetch([{uid:'aBCd1234',title:'Test',content:'abcdefghij',date:'2026-11-01'}]);
 const r=await readMemory({uid:'aBCd1234',offset:3,max_chars:4},ENV,p.fetch);
 assert.equal(r.content,'defg');
 assert.equal(r.next_offset,7);
 const req=p.history[0].request;
 assert.equal(req.table,'lo3rwang_galaxy');
 assert.deepEqual(req.filters,[{column:'uid',operator:'eq',value:'aBCd1234'},
  {column:'list',operator:'eq',value:true}]);
 assert.equal(req.limit,1);
});
test('invalid Scope, UID, query or missing request cannot send network traffic',async()=>{
 const p=fakeFetch([]);
 await assert.rejects(searchMemory({query:'LP26',user_requested:true,scopeid:'admin'},ENV,p.fetch),/public Galaxy/);
 await assert.rejects(searchMemory({query:'x',user_requested:true},ENV,p.fetch),/2–100/);
 await assert.rejects(readMemory({uid:'../../etc'},ENV,p.fetch),/Base62/);
 assert.equal(p.history.length,0);
 await searchMemory({query:'LP26),uid.eq.X',user_requested:true},ENV,p.fetch);
 assert.equal(p.history.length,1);
 assert.deepEqual(p.history[0].request.or,['title.contains."LP26),uid.eq.X",content.contains."LP26),uid.eq.X"']);
});
test('public missing record does not fall back to private articles',async()=>{
 const p=fakeFetch([]);
 const result=await readMemory({uid:'30D7AFD7'},ENV,p.fetch);
 assert.equal(result.found,false);
 assert.equal(p.history.length,1);
});
test('public gateway failures surface errors, never empty results',async()=>{
 await assert.rejects(readMemory({uid:'30D7AFD7'},ENV,async()=>new Response('unavailable',{status:503})),/HTTP 503/);
 await assert.rejects(readMemory({uid:'30D7AFD7'},ENV,async()=>Response.json({error:'invalid'})),/invalid response/);
});
test('Scope routing chooses only explicitly published Galaxy relations',async()=>{
 const p=fakeFetch([{uid:'Aa12BCd3',title:'Runes',content:'符文內文'}]);
 const found=await searchMemory({query:'符文',scopeid:'lrunes',user_requested:true},ENV,p.fetch);
 assert.equal(found.scopeid,'lrunes');
 assert.equal(p.history[0].request.table,'lrunes_galaxy');
 const article=await readMemory({uid:'Aa12BCd3',scopeid:'lrunes'},ENV,p.fetch);
 assert.equal(article.content,'符文內文');
 assert.equal(p.history[1].request.table,'lrunes_galaxy');
 assert.equal(p.history.length,2);
 assert.ok(p.history.every(entry=>entry.options.headers.authorization===undefined));
});
