// Regression for Pattern-first Keyword reanalysis and the bounded Galaxy
// (date,UID) metadata transport. No network, SQL writes or authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIndexedDateKeywordReader} from '../app/loc/keyword-article-reader.mjs';

test('date+UID cursor reads every same-day split and undated timestamp once',async()=>{
  const dated=Array.from({length:2710},(_,i)=>({
    uid:String(i).padStart(8,'0'),
    date:i<2300?'2026-11-14':'2026-11-15',
    createtime:new Date(Date.UTC(2026,10,i<2300?13:14,16)+
      (i<2300?2300-i:2710-i)*1000).toISOString(),
    keyword:true,UpdateTime:'2026-11-15T00:00:00Z'
  }));
  const undated=Array.from({length:102},(_,i)=>({
    uid:'U'+String(i).padStart(7,'0'),
    date:null,
    createtime:i<15?new Date(Date.UTC(2026,10,14,0,i)).toISOString():null
  }));
  let dateQueries=0,undatedQueries=0;
  const read=createIndexedDateKeywordReader({
    maximumRows:3000,
    readDateBatch:async({afterDate,afterUid,limit})=>{
      dateQueries++;
      return dated.filter(row=>afterDate===null||row.date>afterDate||
        row.date===afterDate&&row.uid>afterUid).slice(0,limit);
    },
    readUndated:async()=>{undatedQueries++;return {rows:undated,count:undated.length};}
  });
  const all=[];
  for(;;){
    const page=await read({limit:1000});
    if(!page.length)break;
    all.push(...page);
  }
  assert.equal(all.length,dated.length+undated.length);
  assert.equal(new Set(all.map(row=>row.uid)).size,all.length);
  const firstDay=all.filter(row=>row.date==='2026-11-14');
  assert.equal(firstDay.length,2300);
  assert.ok(firstDay.every((row,index)=>index===0||
    row.createtime>=firstDay[index-1].createtime));
  assert.equal(all.filter(row=>row.date===null&&row.createtime!==null).length,15);
  assert.equal(dateQueries,3);
  assert.equal(undatedQueries,1);
});

test('invalid calendar/time mapping fails before any Pattern result can be written',async()=>{
  const read=createIndexedDateKeywordReader({
    readDateBatch:async()=>[{
      uid:'ARTICLE1',date:'2026-11-14',
      createtime:'2026-11-13T01:00:00Z'
    }],
    readUndated:async()=>({rows:[],count:0})
  });
  await assert.rejects(read({limit:1000}),/日期與發表時間不一致/);
});

test('duplicate date+UID cursor results do not enter the Keyword classifier',async()=>{
  const row={uid:'ARTICLE1',date:'2026-11-14',
    createtime:'2026-11-14T01:00:00Z'};
  const read=createIndexedDateKeywordReader({
    readDateBatch:async()=>[row,row],
    readUndated:async()=>({rows:[],count:0})
  });
  await assert.rejects(read({limit:1000}),/游標排序不完整/);
});

test('Keyword SQL uses actual Pattern UID links and the bounded date cursor',()=>{
  const sql=readFileSync(new URL('../app/loc/keyword-sql-service.mjs',import.meta.url),'utf8');
  const incremental=readFileSync(new URL('../app/loc/keyword-incremental.mjs',import.meta.url),'utf8');
  assert.match(sql,/const links=linked\.flatMap/);
  assert.match(sql,/readScopePatternRows\(db,scope,\{uids\}\)/);
  assert.match(sql,/readDateBatch:async\(\{afterDate,afterUid,limit\}\)/);
  assert.doesNotMatch(sql,/readDatePeers:/);
  assert.match(incremental,/const words=existingPatterns\.map/);
  assert.match(incremental,/Pattern UID index does not match/);
});
