import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchMemory,readMemory} from '../app/loc/mcp/galaxy-read.mjs';

function direct(rows=[]){
 const log=[];
 const query={
  select(columns){log.push(['select',columns]);return this;},
  where(...args){log.push(['where',...args]);return this;},
  orderBy(...args){log.push(['orderBy',...args]);return this;},
  limit(value){log.push(['limit',value]);return this;},
  offset(value){log.push(['offset',value]);return this;},
  async execute(){log.push(['execute']);return rows;}
 };
 const env={locDirectDatabase:async()=>({db:{
  selectFrom(table){log.push(['from',table]);return query;}
 },engine:'postgres',namespace:'silver'})};
 return {env,log};
}
function hasWhere(log,column,operator,value){
 return log.some(row=>row[0]==='where'&&row[1]===column&&
  row[2]===operator&&row[3]===value);
}
test('public Galaxy searches require a real user request and use direct Kysely',async()=>{
 const d=direct([{uid:'30D7AFD7',title:'LP26',date:'2026-11-01'}]);
 await assert.rejects(searchMemory({query:'LP26'},d.env),/使用者明確要求/);
 assert.equal(d.log.length,0);
 const result=await searchMemory({query:'LP26',user_requested:true,limit:10},d.env);
 assert.equal(result.results[0].uid,'30D7AFD7');
 assert.ok(d.log.some(row=>row[0]==='from'&&row[1]==='silver.lo3rwang_galaxy'));
 assert.ok(hasWhere(d.log,'search','=',true));
 assert.ok(d.log.some(row=>row[0]==='where'&&typeof row[1]==='function'));
 assert.deepEqual(d.log.filter(row=>row[0]==='orderBy').map(row=>row.slice(1)),
  [['date','desc'],['createtime','desc']]);
 assert.equal(d.log.some(row=>row[0]==='limit'&&row[1]===10),true);
});
test('public UID read preserves Base62, list=true and bounded content projection',async()=>{
 const d=direct([{uid:'aBCd1234',title:'Test',content:'abcdefghij',date:'2026-11-01'}]);
 const result=await readMemory({uid:'aBCd1234',offset:3,max_chars:4},d.env);
 assert.equal(result.content,'defg');
 assert.equal(result.next_offset,7);
 assert.ok(hasWhere(d.log,'uid','=','aBCd1234'));
 assert.ok(hasWhere(d.log,'list','=',true));
 assert.ok(d.log.some(row=>row[0]==='limit'&&row[1]===1));
 const readCols=d.log.find(row=>row[0]==='select')[1];
 assert.ok(readCols.includes('content'));
});
test('invalid Scope, UID, query or missing human request never touches database',async()=>{
 const d=direct([]);
 await assert.rejects(searchMemory({query:'LP26',user_requested:true,scopeid:'admin'},d.env),/public Galaxy/);
 await assert.rejects(searchMemory({query:'x',user_requested:true},d.env),/2–100/);
 await assert.rejects(readMemory({uid:'../../etc'},d.env),/Base62/);
 await assert.rejects(searchMemory({query:'PR #1252',user_requested:true},d.env),/github/);
 assert.equal(d.log.length,0);
 await searchMemory({query:'LP26),uid.eq.X',user_requested:true},d.env);
 assert.equal(d.log.filter(row=>row[0]==='execute').length,1);
});
test('missing public row never falls through to private database records',async()=>{
 const d=direct([]);
 const result=await readMemory({uid:'30D7AFD7'},d.env);
 assert.equal(result.found,false);
 assert.ok(hasWhere(d.log,'list','=',true));
});
test('without a direct driver, never issue HTTP SQL requests or vendor fallback',async()=>{
 await assert.rejects(readMemory({uid:'30D7AFD7',
 },{LOC_MCP_SQL_GATEWAY_URL:'https://legacy.example/v1/sql'}),/direct Kysely database/);
 const source=readFileSync(new URL('../app/loc/mcp/galaxy-read.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/fetch\s*\(|LOC_SQL_GATEWAY_URL|gatewayUrl|\/v1\/sql/);
 assert.match(source,/lower\(\$\{sql\.ref\('site'\)\}\) not in/);
 assert.match(source,/\.where\('list','=',true\)\.where\(publicSite\)/);
});
test('Scope routing selects only published relations with an in-process Kysely port',async()=>{
 const d=direct([{uid:'Aa12BCd3',title:'Runes',content:'符文內文'}]);
 const match=await searchMemory({query:'符文',scopeid:'lrunes',user_requested:true},d.env);
 assert.equal(match.scopeid,'lrunes');
 const article=await readMemory({uid:'Aa12BCd3',scopeid:'lrunes'},d.env);
 assert.equal(article.content,'符文內文');
 assert.deepEqual(d.log.filter(row=>row[0]==='from').map(row=>row[1]),
  ['silver.lrunes_galaxy','silver.lrunes_galaxy']);
});
