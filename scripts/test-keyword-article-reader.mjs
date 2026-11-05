import test from 'node:test';
import assert from 'node:assert/strict';
import {createChronologicalKeywordReader,createIndexedDateKeywordReader} from '../app/loc/keyword-article-reader.mjs';

const times=['2026-01-01T10:00:00Z','2026-01-01T10:00:00Z','2026-01-01T10:00:00Z',
  '2026-01-02T10:00:00Z','2026-01-03T10:00:00Z','2026-01-03T10:00:00Z',
  '2026-01-04T10:00:00Z',null,null];
const articles=times.map((createtime,i)=>({
  uid:'Ab'+String(i+1).padStart(6,'0'),createtime,content:'靈'
}));
const expected=articles;
const assertComplete=(actual)=>{
  // Same-second rows have no meaningful UID order. Check complete identity
  // membership and chronological ordering rather than random ID ranking.
  assert.equal(actual.length,expected.length);
  assert.deepEqual(new Set(actual.map(row=>row.uid)),new Set(expected.map(row=>row.uid)));
  const timestamps=actual.filter(row=>row.createtime).map(row=>row.createtime);
  assert.deepEqual(timestamps,[...timestamps].sort());
  assert.deepEqual(actual.slice(timestamps.length).map(row=>row.createtime),[null,null]);
};

async function collect(limit,cap=limit){
  const reader=createChronologicalKeywordReader({
    readTimePage:async({after,limit:requested})=>articles
      .filter(a=>a.createtime&&(!after||a.createtime>after))
      .sort((a,b)=>a.createtime.localeCompare(b.createtime))
      .slice(0,Math.min(requested,cap)),
    readTimePeers:async({createtime})=>articles.filter(a=>a.createtime===createtime).reverse(),
    readUndated:async()=>articles.filter(a=>!a.createtime).reverse()
  });
  const seen=[];
  for(let i=0;i<20;i++){
    const chunk=await reader({limit});
    if(!chunk.length)break;
    seen.push(...chunk);
  }
  return seen;
}
for(const pageSize of [1,2,3,5,20]){
  test('timestamp groups and undated articles stay complete at page size '+pageSize,async()=>{
    assertComplete(await collect(pageSize));
  });
}
test('server-imposed short pages do not lose timestamp peers',async()=>{
  assertComplete(await collect(5,2));
});
test('truncated timestamp groups fail instead of publishing partial results',async()=>{
  const reader=createChronologicalKeywordReader({maximumRows:3,
    readTimePage:async()=>articles.slice(0,1),
    readTimePeers:async()=>articles.slice(0,3),
    readUndated:async()=>[]});
  await assert.rejects(reader({limit:1}),/Incomplete publication-time group/);
});


const dated=articles.map(row=>({
  ...row,date:row.createtime?.slice(0,10)||null
}));
async function collectIndexed(limit,cap=limit){
  const reader=createIndexedDateKeywordReader({
    readDatePage:async({after,limit:requested})=>dated
      .filter(row=>row.date&&(!after||row.date>after))
      .sort((a,b)=>a.date.localeCompare(b.date))
      .slice(0,Math.min(requested,cap)),
    readDatePeers:async({date})=>{
      const rows=dated.filter(row=>row.date===date);
      return {rows:rows.reverse(),count:rows.length};
    },
    readUndated:async()=>{
      const rows=dated.filter(row=>!row.date);
      return {rows:rows.reverse(),count:rows.length};
    }
  });
  const all=[];
  for(let i=0;i<30;i++){
    const page=await reader({limit});
    if(!page.length)break;
    all.push(...page);
  }
  return all;
}
for(const size of [1,2,3,5,20]){
  test('indexed date preserves complete chronological classification order at '+size,async()=>{
    assertComplete(await collectIndexed(size));
  });
}
test('indexed reader handles an upstream short page without lost articles',async()=>{
  assertComplete(await collectIndexed(5,2));
});
test('indexed reader orders distinct timestamps within a common date',async()=>{
  const input=[
    {uid:'Ab000002',date:'2026-01-01',createtime:'2026-01-01T12:00:00Z'},
    {uid:'Ab000001',date:'2026-01-01',createtime:'2026-01-01T02:00:00Z'},
    {uid:'Ab000003',date:'2026-01-02',createtime:'2026-01-02T02:00:00Z'}
  ];
  const reader=createIndexedDateKeywordReader({
    readDatePage:async({after})=>input.filter(row=>!after||row.date>after),
    readDatePeers:async({date})=>{
      const rows=input.filter(row=>row.date===date);
      return {rows,count:rows.length};
    },readUndated:async()=>({rows:[],count:0})
  });
  const output=await reader({limit:10});
  assert.deepEqual(output.map(row=>row.uid),['Ab000001','Ab000002','Ab000003']);
});
test('indexed reader rejects a mismatched local date before class writes',async()=>{
  const reader=createIndexedDateKeywordReader({
    readDatePage:async()=>[{uid:'Ab123456',date:'2026-01-02',createtime:'2026-01-01T10:00:00Z'}],
    readDatePeers:async()=>({
      rows:[{uid:'Ab123456',date:'2026-01-02',createtime:'2026-01-01T10:00:00Z'}],count:1
    }),
    readUndated:async()=>({rows:[],count:0})
  });
  await assert.rejects(reader({limit:5}),/日期與發表時間不一致/);
});
test('indexed reader rejects truncated same-day groups',async()=>{
  const reader=createIndexedDateKeywordReader({
    readDatePage:async()=>dated.slice(0,1),
    readDatePeers:async()=>({rows:dated.slice(0,1),count:3}),
    readUndated:async()=>({rows:[],count:0})
  });
  await assert.rejects(reader({limit:1}),/分頁不完整/);
});

test('indexed reader accepts PostgreSQL DATE serialized as UTC midnight',async()=>{
  const records=[
    {uid:'Ab000001',date:'2026-01-01T00:00:00.000Z',createtime:'2026-01-01T02:00:00Z'},
    {uid:'Ab000002',date:'2026-01-02T00:00:00.000Z',createtime:'2026-01-02T02:00:00Z'}
  ];
  const calls=[];
  const reader=createIndexedDateKeywordReader({
    readDatePage:async({after,limit})=>{
      calls.push(after);
      return records.filter(row=>!after||row.date.slice(0,10)>after).slice(0,limit);
    },
    readDatePeers:async({date})=>{
      const rows=records.filter(row=>row.date.slice(0,10)===date);
      return {rows,count:rows.length};
    },
    readUndated:async()=>({rows:[],count:0})
  });
  const first=await reader({limit:1});
  const second=await reader({limit:1});
  const third=await reader({limit:1});
  assert.deepEqual([first[0].date,second[0].date],['2026-01-01','2026-01-02']);
  assert.equal(third.length,0);
  assert.deepEqual(calls,[null,'2026-01-01','2026-01-02']);
});

test('indexed reader still rejects non-midnight datetime in DATE column',async()=>{
  const reader=createIndexedDateKeywordReader({
    readDatePage:async()=>[{uid:'Ab000001',date:'2026-01-01T12:00:00Z',createtime:'2026-01-01T12:00:00Z'}],
    readDatePeers:async()=>({rows:[],count:0}),
    readUndated:async()=>({rows:[],count:0})
  });
  await assert.rejects(reader({limit:1}),/日期游標排序不完整/);
});


test('indexed reader restores SQL DATE serialized at Taipei midnight',async()=>{
  const records=[
    {uid:'Ab000001',date:'2025-12-31T16:00:00.000Z',createtime:'2026-01-01T02:00:00Z'},
    {uid:'Ab000002',date:'2026-01-01T16:00:00.000Z',createtime:'2026-01-02T02:00:00Z'}
  ];
  const calls=[];
  const reader=createIndexedDateKeywordReader({
    readDatePage:async({after,limit})=>{
      calls.push(after);
      return records.filter(row=>!after||new Date(row.date).toISOString().slice(0,10)>=after)
        .slice(0,limit);
    },
    readDatePeers:async({date})=>{
      const rows=records.filter(row=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.date))===date);
      return {rows,count:rows.length};
    },
    readUndated:async()=>({rows:[],count:0})
  });
  assert.deepEqual((await reader({limit:1})).map(row=>row.date),['2026-01-01']);
  assert.deepEqual((await reader({limit:1})).map(row=>row.date),['2026-01-02']);
  assert.deepEqual(await reader({limit:1}),[]);
  assert.deepEqual(calls,[null,'2026-01-01','2026-01-02']);
});
