import test from 'node:test';
import assert from 'node:assert/strict';
import {importCheckinDates,importCheckinDayEntries,prepareImportTimeAnchors} from '../app/loc/import-time-anchors.mjs';

function memoryTime(initial=[],scopeId='lo3rwang'){
  const rows=initial.map(row=>({
    ...row,type:row.type==='anchor'?'date':row.type,
    attr:row.type==='anchor'?{date:row.address}:row.attr||{}
  }));
  const calls=[],updates=[];
  return {
    rows,calls,updates,
    relation:table=>{
      assert.equal(table,'silver.'+scopeId+'_anchor');
      return {
        select:()=>{
          const filters=[];
          const q={
            eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},
            order:()=>q,
            range:async(start,end)=>({
              data:rows.filter(row=>filters.every(fn=>fn(row))).slice(start,end+1),
              error:null
            })
          };
          return q;
        },
        insert:batch=>({select:async()=>{
          calls.push(batch);
          const saved=batch.map(row=>({...row,address:row.attr.date||null}));
          rows.push(...saved);
          return {data:batch.map(({uid,type,attr})=>({uid,type,attr})),error:null};
        }}),
        update:patch=>{
          const matches=[];
          const query={
            eq:(key,value)=>{matches.push([key,value]);return query;},
            is:(key,value)=>{matches.push([key,value]);return query;},
            select:async()=>{
              const row=rows.find(item=>matches.every(([key,value])=>item[key]===value));
              if(!row)return {data:[],error:null};
              updates.push({uid:row.uid,patch});
              Object.assign(row,patch);
              return {data:[{uid:row.uid}],error:null};
            }
          };
          return query;
        }
      };
    }
  };
}

test('check-in dates are daily and deduplicated; missing names and dates are ignored',()=>{
  assert.deepEqual(importCheckinDates([
    {location:'台北車站',__importCheckin:true,createtime:'2024-02-01T08:00:00.000Z'},
    {location:'台北車站',createtime:'2024-02-01T20:00:00.000Z'},
    {__importPlaceName:'咖啡廳',__importVisitTimes:['2024-02-02T13:00:00.000Z','2024-02-03T00:00:00.000Z']},
    {__importPlaceName:'咖啡廳',__importVisitTimes:['2024-02-02T13:00:00.000Z']},
    {location:'深夜打卡',__importCheckin:true,createtime:'2024-02-03T20:30:00.000Z'},
    {location:'地名但沒有日期'},
    {createtime:'2024-02-04T00:00:00.000Z'}
  ]),['2024-02-01','2024-02-02','2024-02-03','2024-02-04']);
});

test('Time import reuses existing dates, generates secure Base62 UIDs, and is idempotent',async()=>{
  const db=memoryTime([
    {uid:'00000001',type:'anchor',address:'2024-02-01'},
    {uid:'00000002',type:'time_period',address:null}
  ]);
  const records=[
    {location:'既有地點',__importCheckin:true,createtime:'2024-02-01T09:00:00.000Z'},
    {location:'新地點',__importCheckin:true,createtime:'2024-02-02T09:00:00.000Z'},
    {location:'另一個地點',__importCheckin:true,createtime:'2024-02-03T09:00:00.000Z'},
    {location:'同一天',__importCheckin:true,createtime:'2024-02-03T10:00:00.000Z'}
  ];
  const first=await prepareImportTimeAnchors(records,{scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation});
  assert.equal(first.created,2);
  assert.equal(first.reused,1);
  assert.deepEqual(db.rows.slice(2).map(row=>[row.address,row.type,row.invisible]),[
    ['2024-02-02','date',false],
    ['2024-02-03','date',false]
  ]);
  assert.ok(db.rows.slice(2).every(row=>/^[A-Za-z0-9]{8}$/.test(row.uid)));
  assert.equal(new Set(db.rows.slice(2).map(row=>row.uid)).size,2);
  const again=await prepareImportTimeAnchors(records,{scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation});
  assert.equal(again.created,0);
  assert.equal(again.reused,3);
  assert.equal(db.calls.length,1);
});

test('lrunes Date anchors use native store and the same eight-character UID rule',async()=>{
  const db=memoryTime([{uid:'AaBb1234',type:'date',
    title:'已知',attr:{date:'2026-10-16'}}],'lrunes');
  const events=[
    {location:'已知地點',date:'2026-10-16'},
    {location:'新地點',date:'2026-10-17'}
  ];
  const first=await prepareImportTimeAnchors(events,{
    scopeId:'lrunes',timeTable:'silver.lrunes_time',relation:db.relation
  });
  assert.equal(first.reused,1);
  assert.equal(first.created,1);
  assert.equal(db.rows.at(-1).type,'date');
  assert.match(db.rows.at(-1).uid,/^[A-Za-z0-9]{8}$/);
  assert.deepEqual(db.rows.at(-1).attr,{date:'2026-10-17'});
  const second=await prepareImportTimeAnchors(events,{
    scopeId:'lrunes',timeTable:'silver.lrunes_time',relation:db.relation
  });
  assert.equal(second.created,0);
  assert.equal(second.reused,2);
});

test('same-day article titles appear as 重要大事 joined with ｜, with oldest headline as title',async()=>{
  const entries=importCheckinDayEntries([
    {title:'第二篇',location:'台北車站',date:'2024-08-01',createtime:'2024-08-01T02:00:00Z'},
    {title:'第一篇',location:'台北車站',date:'2024-08-01',createtime:'2024-08-01T01:00:00Z'},
    {title:'第二篇',location:'台北車站',date:'2024-08-01',createtime:'2024-08-01T02:00:00Z'},
    {title:'單篇文章',location:'另一地點',date:'2024-08-02'},
    {__importPlaceName:'獨立打卡點',__importVisitTimes:['2024-08-03T10:00:00.000Z']}
  ]);
  assert.deepEqual(entries,[
    {date:'2024-08-01',title:'第一篇',description:'重要大事：第一篇｜第二篇'},
    {date:'2024-08-02',title:'單篇文章',description:'重要大事：單篇文章'},
    {date:'2024-08-03',title:'獨立打卡點',description:'重要大事：獨立打卡點'}
  ]);
  const db=memoryTime();
  const res=await prepareImportTimeAnchors([
    {title:'第一篇',location:'台北車站',date:'2024-08-01'},
    {title:'第二篇',location:'台北車站',date:'2024-08-01'}
  ],{scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation});
  assert.equal(res.created,1);
  assert.equal(db.rows[0].title,'第一篇');
  assert.equal(db.rows[0].description,'重要大事：第一篇｜第二篇');
  assert.equal(db.rows[0].address,'2024-08-01');
});

test('only repairs dated blank machine placeholders, never human-authored Time anchors',async()=>{
  const db=memoryTime([
    {uid:'00000001',type:'anchor',title:'2024-08-01',description:'',address:'2024-08-01'},
    {uid:'00000002',type:'anchor',title:'2024-08-02',description:null,address:'2024-08-02'},
    {uid:'00000003',type:'anchor',title:'人工標題',description:'人工內容',address:'2024-08-03'},
    {uid:'00000004',type:'anchor',title:'2024-08-04',description:'已有敘述',address:'2024-08-04'}
  ]);
  const inputs=['2024-08-01','2024-08-02','2024-08-03','2024-08-04']
    .map((date,i)=>({title:'文章'+(i+1),location:'地點',date}));
  const result=await prepareImportTimeAnchors(inputs,{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation
  });
  assert.equal(result.created,0);
  assert.equal(result.repaired,2);
  assert.equal(result.reused,4);
  assert.deepEqual(db.updates.map(item=>item.uid),['00000001','00000002']);
  assert.equal(db.rows[0].title,'文章1');
  assert.equal(db.rows[0].description,'重要大事：文章1');
  assert.equal(db.rows[1].title,'文章2');
  assert.equal(db.rows[2].title,'人工標題');
  assert.equal(db.rows[2].description,'人工內容');
  assert.equal(db.rows[3].description,'已有敘述');
});

test('an empty or local date import never writes to remote relations',async()=>{
  const fail=()=>{throw Error('Should not query remote DB');};
  assert.equal((await prepareImportTimeAnchors([{location:'X'}],{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:fail
  })).created,0);
  assert.equal((await prepareImportTimeAnchors([{location:'X',__importCheckin:true,createtime:'2023-01-01'}],{
    scopeId:'local',relation:fail
  })).created,0);
});

test('standalone visit importer keeps original per-visit timestamps and writes Time dates',async()=>{
  const {readFileSync}=await import('node:fs');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/__importVisitTimes:time\?\[/);
  assert.match(panel,/const dates=await prepareImportTimeAnchors\(candidates,/);
  assert.match(panel,/recordImportPlaceVisits\(visits,\{/);
  assert.match(panel,/prepareImportTimeAnchors\(\[\.\.\.checkinAnchorRecords,\.\.\.geoAnchorRecords\]/);
});

test('Scope Time registry stays validated while Date is stored in native Anchor',async()=>{
  const calls=[];
  const relation=table=>{
    calls.push(table);
    const q={eq:()=>q,order:()=>q,range:async()=>({data:[],error:null})};
    return {select:()=>q,
      insert:rows=>({select:async()=>({data:rows.map(({uid,type,attr})=>({uid,type,attr})),error:null})})};
  };
  const inputs=[{location:'已打卡',__importCheckin:true,createtime:'2025-07-01T08:00:00Z'}];
  await prepareImportTimeAnchors(inputs,{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time_archive',relation
  });
  assert.deepEqual(calls,['silver.lo3rwang_anchor','silver.lo3rwang_anchor']);
  await assert.rejects(()=>prepareImportTimeAnchors(inputs,{
    scopeId:'lo3rwang',relation
  }),/尚未解析正確的 Scope Time 資料表/);
});


test('an article location is an import check-in; date wins over timestamp',()=>{
  assert.deepEqual(importCheckinDates([
    {location:'文章地點',date:'2024-04-05',createtime:'2024-04-01T10:00:00Z'},
    {location:'另一篇文章',__importCoordinates:{latitude:25,longitude:121},
      createtime:'2024-04-02T10:00:00Z'},
    {location:'明確打卡',__importCheckin:true,createtime:'2024-04-03T10:00:00Z'},
    {__importPlaceName:'獨立打卡',__importVisitTimes:['2024-04-04T12:00:00Z']}
  ]),['2024-04-02','2024-04-03','2024-04-04','2024-04-05']);
});

test('an existing period does not conceal a missing exact date anchor',async()=>{
  const db=memoryTime([
    {uid:'00000001',type:'anchor',address:'2024-01-01',anchor_ids:[]},
    {uid:'00000002',type:'anchor',address:'2024-01-31',anchor_ids:[]},
    {uid:'00000003',type:'period',address:null,anchor_ids:['00000001','00000002']},
    {uid:'00000004',type:'era',address:null,anchor_ids:['00000003']}
  ]);
  const events=[
    {location:'期間內',__importCheckin:true,createtime:'2024-01-12T04:30:00Z'},
    {location:'端點日期',__importCheckin:true,createtime:'2024-01-31T04:30:00Z'},
    {location:'超出期間',__importCheckin:true,createtime:'2024-02-03T04:30:00Z'}
  ];
  const first=await prepareImportTimeAnchors(events,{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation
  });
  assert.equal(first.created,2);
  assert.equal(first.reused,1);
  assert.equal(db.rows.at(-1).address,'2024-02-03');
  const next=await prepareImportTimeAnchors(events,{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation
  });
  assert.equal(next.created,0);
  assert.equal(next.reused,3);
});

test('a shared timezone formatter preserves Taipei midnight and date literal precedence',()=>{
  const records=[
    {location:'午夜',createtime:'2024-02-01T15:59:59.000Z'},
    {location:'午夜',createtime:'2024-02-01T16:00:00.000Z'},
    {location:'已有日期',date:'2024-01-15',createtime:'2024-02-01T16:00:00.000Z'}
  ];
  assert.deepEqual(importCheckinDates(records),['2024-01-15','2024-02-01','2024-02-02']);
});
test('ordinary article dates never generate birthday or anniversary Time anchors',async()=>{
  const db=memoryTime([
    {uid:'00000001',type:'anchor',title:'初次事件',address:'2020-10-16',
      description:'人工編輯'}
  ]);
  const ordinary=[
    {uid:'aaa',date:'2026-10-16',title:'多年後',location:null},
    {uid:'bbb',date:'2026-06-23',title:'生日這篇',location:null},
    {uid:'ccc',date:'2026-12-01',title:'普通日',location:null},
    {uid:'ddd',date:'2026-06-23',title:'同日第二篇',location:null}
  ];
  const result=await prepareImportTimeAnchors(ordinary,{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',
    relation:db.relation,anniversaryRecords:ordinary,birthday:'1980-06-23'
  });
  assert.equal(result.created,0);
  assert.equal(result.anniversaries,0);
  assert.equal(db.rows.length,1);
  assert.equal(db.rows[0].description,'人工編輯');
  assert.equal(db.calls.length,0);
});
test('check-in date matching an anniversary is only reused or created as a check-in',async()=>{
  const db=memoryTime([{uid:'00000001',type:'anchor',title:'原始事件',address:'2020-10-16'}]);
  const checkins=[{title:'同日打卡',location:'咖啡店',date:'2026-10-16'}];
  const result=await prepareImportTimeAnchors(checkins,{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation,
    anniversaryRecords:checkins,birthday:'1980-06-23'
  });
  assert.equal(result.created,1);
  assert.equal(result.anniversaries,0);
  assert.equal(db.rows[1].title,'同日打卡');
  assert.equal(db.rows[1].address,'2026-10-16');
  assert.doesNotMatch(db.rows[1].description,/週年紀念/);
});

test('existing calendar anchors always win even when imported check-ins are anniversaries',async()=>{
  const db=memoryTime([
    {uid:'00000001',type:'anchor',title:'原始日',address:'2020-06-23'},
    {uid:'00000002',type:'anchor',title:'人工名稱',description:'人工備註',address:'2026-06-23'}
  ]);
  const r=await prepareImportTimeAnchors([{location:'打卡',date:'2026-06-23'}],{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation,
    anniversaryRecords:[{date:'2026-06-23'}],birthday:'1980-06-23'
  });
  assert.equal(r.created,0);
  assert.equal(db.rows[1].title,'人工名稱');
  assert.equal(db.rows[1].description,'人工備註');
});


test('plain article dates never generate anniversary or birthday Time anchors',async()=>{
  const db=memoryTime([
    {uid:'00000001',type:'anchor',title:'原始事件',address:'2020-10-16',description:'人工記載'}
  ]);
  const result=await prepareImportTimeAnchors([],{
    scopeId:'lo3rwang',timeTable:'silver.lo3rwang_time',relation:db.relation,
    anniversaryRecords:[
      {uid:'POST1',date:'2026-10-16',title:'普通文章',location:null},
      {uid:'POST2',date:'2026-06-23',title:'生日日期文章',location:null}
    ],
    birthday:'1980-06-23'
  });
  assert.equal(result.created,0);
  assert.equal(result.anniversaries,0);
  assert.equal(db.rows.length,1);
  assert.equal(db.calls.length,0);
});
