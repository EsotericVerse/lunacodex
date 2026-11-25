import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timeIntersectionMetrics,spaceIntersectionMetrics,
  fourDimensionDailyCounts
} from '../app/loc/statistics/four-anchor-intersection.mjs';
import {comparisonMetricGroups} from '../app/modular/modules/statistics/statistics-compare-options.mjs';

const anchor=(type,uid,title,attr)=>({type,uid,title,attr});
const dayCount=(counts,metric,day)=>counts.get(metric.id)?.get(day)||0;
const labels=(rows)=>rows.map(row=>row.name);

const timeline=[
  anchor('date','DATE0001','Jan 1',{date:'2026-01-01'}),
  anchor('date','DATE0002','Jan 31',{date:'2026-01-31'}),
  anchor('date','DATE0003','Mar 1',{date:'2026-03-01'}),
  anchor('date','DATE0004','Mar 31',{date:'2026-03-31'}),
  anchor('period','PERI0001','January',{uid:['DATE0001','DATE0002']}),
  anchor('period','PERI0002','March',{uid:['DATE0003','DATE0004']}),
  anchor('period','PERI0003','Unassigned',{date:['2026-04-01','2026-04-30']}),
  anchor('era','ERA00001','Year Part',{period:['PERI0001','PERI0002'],
    date:['2026-01-01','2026-03-31']})
];
const places=[
  anchor('point','POIN0001','One',{latitude:25,longitude:121}),
  anchor('point','POIN0002','Two',{latitude:25,longitude:121}),
  anchor('path','PATH0001','Road One',{point:['POIN0001','POIN0001','POIN0002']}),
  anchor('path','PATH0002','Other Road',{point:['POIN0002']}),
  anchor('trace','TRAC0001','My Trace',{
    path:['PATH0001'],point:['POIN0001','POIN0001']
  })
];

test('Era combines actual Period ranges without filling the gaps between them',()=>{
  const metrics=timeIntersectionMetrics(timeline);
  assert.deepEqual(metrics.map(row=>row.kind),['era','period','period','period']);
  const era=metrics.find(x=>x.kind==='era');
  assert.deepEqual(era.windows,[
    {startDate:'2026-01-01',endDate:'2026-01-31'},
    {startDate:'2026-03-01',endDate:'2026-03-31'}
  ]);
  assert.deepEqual(metrics.find(x=>x.uid==='PERI0003').windows,[
    {startDate:'2026-04-01',endDate:'2026-04-30'}
  ]);
  const counts=fourDimensionDailyCounts({
    selected:metrics,
    sourceRows:[
      {day:'2026-01-15',kind:'total',item_count:2},
      {day:'2026-02-10',kind:'total',item_count:10},
      {day:'2026-03-10',kind:'total',item_count:3},
      {day:'2026-04-02',kind:'total',item_count:1}
    ]
  });
  assert.equal(dayCount(counts,era,'2026-01-15'),2);
  assert.equal(dayCount(counts,era,'2026-02-10'),0);
  assert.equal(dayCount(counts,era,'2026-03-10'),3);
  assert.equal(dayCount(counts,era,'2026-04-02'),0);
  assert.equal(dayCount(counts,metrics.find(x=>x.uid==='PERI0003'),'2026-04-02'),1);
});

test('Trace counts linked Path points and direct points once per real place/day/site',()=>{
  const metrics=spaceIntersectionMetrics(places);
  assert.deepEqual(metrics.map(x=>x.kind),['trace','path','path']);
  const trace=metrics.find(x=>x.kind==='trace');
  assert.deepEqual([...trace.points].sort(),['POIN0001','POIN0002']);
  assert.deepEqual(trace.children,['PATH0001']);
  const counts=fourDimensionDailyCounts({
    selected:metrics,
    placeRows:[
      {day:'2026-01-15',place_id:'POIN0001',site:'Facebook',item_count:2},
      {day:'2026-01-15',place_id:'POIN0002',site:'Threads',item_count:3},
      {day:'2026-01-15',place_id:'FAKE0001',site:'Facebook',item_count:9}
    ]
  });
  assert.equal(dayCount(counts,trace,'2026-01-15'),5);
  assert.equal(dayCount(counts,metrics.find(x=>x.uid==='PATH0001'),'2026-01-15'),5);
  assert.equal(dayCount(counts,metrics.find(x=>x.uid==='PATH0002'),'2026-01-15'),3);
});

test('all four families are present in the cascading metric picker',()=>{
  const mk=(name,id)=>({name,id});
  const groups=comparisonMetricGroups('all',{
    time:[{name:'Era',item:mk('ERA','era\u0000UID00001'),items:[]}],
    space:[{name:'Trace',item:mk('TRACE','trace\u0000UID00002'),items:[]}],
    keyword:[{name:'Group',item:mk('GROUP','keyword_group\u0000UID00003'),items:[]}],
    source:[{name:'Galaxy',item:mk('CMS','source_galaxy\u0000UID00004'),items:[]}]
  });
  assert.deepEqual(labels(groups),['Era','Trace','Group','Galaxy']);
  assert.equal(new Set(groups.flatMap(x=>x.options).map(x=>x.id)).size,4);
});
