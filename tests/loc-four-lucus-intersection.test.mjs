import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timeIntersectionMetrics,spaceIntersectionMetrics,sourceIntersectionMetrics,
  fourDimensionDailyCounts,areLucusMetricsMutuallyExclusive
} from '../app/loc/statistics/four-lucus-intersection.mjs';

const lucus=(type,uid,title,attr)=>({type,uid,title,attr});
const dayCount=(counts,metric,day)=>counts.get(metric.id)?.get(day)||0;
const labels=(rows)=>rows.map(row=>row.name);

test('composition is limited to mutually exclusive siblings within one Lucus level',()=>{
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'period',parentUid:'ERA00001',windows:[{startDate:'2026-01-01',endDate:'2026-01-31'}]},
    {kind:'period',parentUid:'ERA00001',windows:[{startDate:'2026-02-01',endDate:'2026-02-28'}]}
  ]),true);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'period',parentUid:'ERA00001',windows:[{startDate:'2026-01-01',endDate:'2026-02-15'}]},
    {kind:'period',parentUid:'ERA00001',windows:[{startDate:'2026-02-01',endDate:'2026-02-28'}]}
  ]),false);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'trace',points:new Set(['POIN0001'])},
    {kind:'trace',points:new Set(['POIN0002'])}
  ]),true);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'trace',points:new Set(['POIN0001'])},
    {kind:'trace',points:new Set(['POIN0001','POIN0002'])}
  ]),false);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'source_tree',type:'domain',parentUid:'GALAXY1'},
    {kind:'source_tree',type:'domain',parentUid:'GALAXY1'}
  ]),true);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'source_tree',type:'domain',parentUid:'GALAXY1'},
    {kind:'source_tree',type:'from',parentUid:'DOMAIN01'}
  ]),false);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'keyword_group',parentUid:'CLASS001'},
    {kind:'keyword_group',parentUid:'CLASS001'}
  ]),true);
  assert.equal(areLucusMetricsMutuallyExclusive([
    {kind:'keyword_item',parentUid:'GROUP001'},
    {kind:'keyword_item',parentUid:'GROUP001'}
  ]),false);
});

const timeline=[
  lucus('date','DATE0001','Jan 1',{date:'2026-01-01'}),
  lucus('date','DATE0002','Jan 31',{date:'2026-01-31'}),
  lucus('date','DATE0003','Mar 1',{date:'2026-03-01'}),
  lucus('date','DATE0004','Mar 31',{date:'2026-03-31'}),
  lucus('period','PERI0001','January',{uid:['DATE0001','DATE0002']}),
  lucus('period','PERI0002','March',{uid:['DATE0003','DATE0004']}),
  lucus('period','PERI0003','Unassigned',{date:['2026-04-01','2026-04-30']}),
  lucus('era','ERA00001','Year Part',{period:['PERI0001','PERI0002'],
    date:['2026-01-01','2026-03-31']})
];
const places=[
  lucus('point','POIN0001','One',{latitude:25,longitude:121}),
  lucus('point','POIN0002','Two',{latitude:25,longitude:121}),
  lucus('path','PATH0001','Road One',{point:['POIN0001','POIN0001','POIN0002']}),
  lucus('path','PATH0002','Other Road',{point:['POIN0002']}),
  lucus('trace','TRAC0001','My Trace',{
    path:['PATH0001'],point:['POIN0001','POIN0001']
  })
];

test('Era combines actual Period ranges without filling the gaps between them',()=>{
  const metrics=timeIntersectionMetrics(timeline);
  assert.deepEqual(metrics.map(row=>row.kind),['era','period','period','period']);
  const era=metrics.find(x=>x.kind==='era');
  assert.equal(era.durationDays,62);
  assert.equal(era.periodCount,2);
  assert.equal(era.dateAnchorCount,4);
  assert.equal(metrics.find(x=>x.uid==='PERI0001').durationDays,31);
  assert.equal(metrics.find(x=>x.uid==='PERI0001').dateAnchorCount,2);
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

test('SLucus exposes all four real hierarchy levels as numeric daily metrics',()=>{
  const taxonomy={
    tree:[
      {uid:'UNIV0001',type:'universe',title:'Words',path:['UNIV0001'],level:0},
      {uid:'GALA0001',type:'galaxy',title:'CMS',path:['UNIV0001','GALA0001'],level:1},
      {uid:'DOMA0001',type:'domain',title:'Meta',path:['UNIV0001','GALA0001','DOMA0001'],level:2},
      {uid:'FROM0001',type:'from',title:'Facebook',path:['UNIV0001','GALA0001','DOMA0001','FROM0001'],level:3}
    ],
    aliases:[{source_key:'facebook',category_code:'FROM0001'}]
  };
  const metrics=sourceIntersectionMetrics(taxonomy);
  assert.deepEqual(new Set(metrics.map(row=>row.type)),
    new Set(['universe','galaxy','domain','from']));
  const sourceRows=[{day:'2026-01-15',kind:'source',category:'Facebook',item_count:4}];
  const counts=fourDimensionDailyCounts({selected:metrics,sourceRows,taxonomy});
  for(const metric of metrics)
    assert.equal(dayCount(counts,metric,'2026-01-15'),4);
  assert.deepEqual(metrics.find(row=>row.type==='from').path,
    ['UNIV0001','GALA0001','DOMA0001','FROM0001']);
});

test('Trace counts linked Path points and direct points once per real place/day/site',()=>{
  const metrics=spaceIntersectionMetrics(places);
  assert.deepEqual(metrics.map(x=>x.kind),['trace','path','path']);
  const trace=metrics.find(x=>x.kind==='trace');
  assert.deepEqual([...trace.points].sort(),['POIN0001','POIN0002']);
  assert.deepEqual(trace.children,['PATH0001']);
  assert.equal(trace.pointCount,2);
  assert.equal(trace.pathCount,1);
  assert.equal(trace.childCount,1);
  assert.equal(metrics.find(x=>x.uid==='PATH0001').pointCount,2);
  assert.equal(metrics.find(x=>x.uid==='PATH0001').childCount,2);
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

