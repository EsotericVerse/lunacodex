import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATISTIC_INTENTS,availableStatisticIntents,compositionPercentages,
  compositionTrendRows,histogramBins,normalizeFunnelStages,
  recordScatterPair,resolveStatisticIntent
} from '../app/modular/modules/statistics/statistics-time-zoom.mjs';

const series=[{key:'a',label:'A'},{key:'b',label:'B'}];
const rows=count=>Array.from({length:count},(_,index)=>({
  period:'p'+index,a:index+1,b:count-index
}));
const distribution=count=>Array.from({length:count},(_,index)=>({
  key:'c'+index,name:'Category '+index,value:count-index
}));

test('the intent catalogue contains the nine declared questions',()=>{
  assert.deepEqual(STATISTIC_INTENTS.map(([id])=>id),[
    'compare','trend','composition','compositionTrend','relationship',
    'distribution','ranking','attainment','funnel'
  ]);
});

test('comparison switches from columns to sorted horizontal bars after six categories',()=>{
  assert.equal(resolveStatisticIntent({
    intent:'compare',distribution:distribution(6)
  }).barLayout,'horizontal');
  assert.equal(resolveStatisticIntent({
    intent:'compare',distribution:distribution(7)
  }).barLayout,'vertical');
  assert.equal(resolveStatisticIntent({
    intent:'compare',distribution:distribution(6)
  }).sort,undefined);
  assert.equal(resolveStatisticIntent({
    intent:'compare',distribution:distribution(7)
  }).sort,'desc');
});

test('time comparisons use columns through six periods and horizontal bars after six',()=>{
  assert.equal(resolveStatisticIntent({
    intent:'compare',rows:rows(6),totalKey:'total'
  }).barLayout,'horizontal');
  assert.equal(resolveStatisticIntent({
    intent:'compare',rows:rows(7),totalKey:'total'
  }).barLayout,'vertical');
  assert.equal(resolveStatisticIntent({
    intent:'compare',rows:[{period:'p1',total:1},{period:'p2',total:4}],
    totalKey:'total'
  }).dataMode,'time-comparison');
});

test('trend uses columns below six points and a line from six points onward',()=>{
  assert.equal(resolveStatisticIntent({
    intent:'trend',rows:rows(3),series
  }).type,'bar');
  assert.equal(resolveStatisticIntent({
    intent:'trend',rows:rows(5),series
  }).type,'bar');
  assert.equal(resolveStatisticIntent({
    intent:'trend',rows:rows(6),series
  }).type,'line');
});

test('composition charts require mutually exclusive dimensions',()=>{
  assert.equal(resolveStatisticIntent({
    intent:'composition',distribution:distribution(3)
  }).available,false);
  assert.equal(resolveStatisticIntent({
    intent:'composition',distribution:distribution(3),mutuallyExclusive:true
  }).type,'composition');
  assert.equal(resolveStatisticIntent({
    intent:'compositionTrend',rows:rows(8),series
  }).available,false);
  assert.equal(resolveStatisticIntent({
    intent:'compositionTrend',rows:rows(8),series,seriesExclusive:true
  }).type,'compositionTrend');
});

test('composition normalizes every category to an exact 100 percent total',()=>{
  const rows=compositionPercentages(distribution(4));
  assert.equal(Math.round(rows.reduce((sum,row)=>sum+row.percent,0)*100)/100,100);
  assert.ok(rows.every(row=>row.percent>0));
  const grouped=compositionPercentages(distribution(10),7);
  assert.equal(grouped.length,8);
  assert.equal(grouped.at(-1).aggregated,true);
  assert.equal(grouped.at(-1).items.length,3);
  assert.equal(Math.round(grouped.reduce((sum,row)=>sum+row.percent,0)*100)/100,100);
});

test('composition over time keeps a 100 percent denominator and groups overflow into Other',()=>{
  const sourceSeries=Array.from({length:10},(_,index)=>({
    key:'s'+index,label:'Source '+index
  }));
  const sourceRows=Array.from({length:2},(_,period)=>({
    period:'p'+period,
    ...Object.fromEntries(sourceSeries.map((field,index)=>[
      field.key,(10-index)*(period+1)
    ]))
  }));
  const result=compositionTrendRows(sourceRows,sourceSeries,7);
  assert.equal(result.fields.length,8);
  assert.equal(result.fields.at(-1).aggregated,true);
  for(const row of result.rows){
    const percent=result.fields.reduce((sum,field)=>sum+row[field.dataKey],0);
    assert.ok(Math.abs(percent-100)<1e-8);
  }
});

test('relationship points retain one raw record identity per dot',()=>{
  const records=[
    {uid:'record01',x:10,y:3,title:'First'},
    {uid:'record02',x:20,y:5,title:'Second'},
    {uid:'record03',x:30,y:8,title:'Third'}
  ];
  const pair=recordScatterPair(records,[
    {key:'x',label:'X'},{key:'y',label:'Y'}
  ]);
  assert.equal(pair.data.length,3);
  assert.deepEqual(pair.data.map(row=>row.recordId),[
    'record01','record02','record03'
  ]);
  assert.equal(resolveStatisticIntent({
    intent:'relationship',records,recordFields:[
      {key:'x',label:'X'},{key:'y',label:'Y'}
    ]
  }).type,'scatter');
  assert.equal(resolveStatisticIntent({
    intent:'relationship',rows:rows(10),series
  }).available,false);
});

test('histogram preserves numeric distribution rather than replacing it with a mean',()=>{
  const bins=histogramBins([300,310,320,1900,2000,2100]);
  assert.ok(bins.length>1);
  assert.equal(bins.reduce((sum,bin)=>sum+bin.count,0),6);
  assert.equal(resolveStatisticIntent({
    intent:'distribution',values:[300,310,320,1900,2000,2100]
  }).type,'histogram');
});

test('ranking always uses horizontal bars and emphasizes the first three',()=>{
  const result=resolveStatisticIntent({
    intent:'ranking',distribution:distribution(8)
  });
  assert.equal(result.type,'bar');
  assert.equal(result.barLayout,'vertical');
  assert.equal(result.highlightTop,3);
});

test('attainment requires an actual value and explicit target',()=>{
  assert.equal(resolveStatisticIntent({
    intent:'attainment',attainmentValue:75
  }).available,false);
  const result=resolveStatisticIntent({
    intent:'attainment',attainmentValue:75,targetValue:100
  });
  assert.equal(result.type,'attainment');
  assert.equal(result.ratio,75);
});

test('funnel calculates conversion between adjacent stages and from the first stage',()=>{
  const stages=normalizeFunnelStages([
    {key:'visit',name:'瀏覽',value:100},
    {key:'signup',name:'註冊',value:80},
    {key:'active',name:'啟用',value:40}
  ]);
  assert.deepEqual(stages.map(row=>row.conversionRate),[100,80,50]);
  assert.deepEqual(stages.map(row=>row.overallRate),[100,80,40]);
  assert.deepEqual(stages.map(row=>row.dropOff),[0,20,40]);
  assert.equal(resolveStatisticIntent({
    intent:'funnel',stages
  }).type,'funnel');
});

test('all nine intents become available only when their required data is supplied',()=>{
  const records=[
    {uid:'r1',x:1,y:4},{uid:'r2',x:2,y:5},{uid:'r3',x:3,y:6}
  ];
  const available=availableStatisticIntents({
    rows:rows(8),series,distribution:distribution(4),
    mutuallyExclusive:true,seriesExclusive:true,
    records,recordFields:[{key:'x',label:'X'},{key:'y',label:'Y'}],
    values:[1,2,3,4],attainmentValue:80,targetValue:100,
    stages:[{name:'A',value:100},{name:'B',value:50}]
  });
  assert.deepEqual(available,[
    'compare','trend','composition','compositionTrend',
    'relationship','distribution','ranking','attainment','funnel'
  ]);
});

test('unsupported intents are not offered without their required source data',()=>{
  const available=availableStatisticIntents({
    rows:rows(8),series,distribution:distribution(4)
  });
  assert.ok(available.includes('trend'));
  assert.ok(available.includes('compare'));
  assert.ok(!available.includes('composition'));
  assert.ok(!available.includes('relationship'));
  assert.ok(!available.includes('distribution'));
  assert.ok(!available.includes('attainment'));
  assert.ok(!available.includes('funnel'));
});
