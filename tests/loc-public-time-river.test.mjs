import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPublicTimeLucusRiver} from '../app/loc/culture/public-time-river.mjs';
import {parseLucusFeatureQuery} from '../app/loc/model/lucus-feature-queries.mjs';

const root=new URL('../',import.meta.url);
const source=async path=>readFile(new URL(path,root),'utf8');
const rows=[
  {uid:'ERAAAAAA',type:'era',title:'近代',attr:{period:['PERIOD1A']}},
  {uid:'ERBBBBBB',type:'era',title:'古代',attr:{period:['PERIOD2B']}},
  {uid:'PERIOD1A',type:'period',title:'近代期間',attr:{uid:['DATE0001','DATE0002']}},
  {uid:'PERIOD2B',type:'period',title:'古代期間',attr:{uid:['DATE0003']}},
  {uid:'DATE0001',type:'date',title:'近代定錨一',attr:{date:'2026-02-10'}},
  {uid:'DATE0002',type:'date',title:'近代定錨二',attr:{date:'2026-08-18'}},
  {uid:'DATE0003',type:'date',title:'古代定錨',attr:{date:'2024-03-01'}},
  {uid:'DATE0004',type:'date',title:'未歸屬定錨',attr:{date:'2026-04-02'}}
];

test('Scope TimeLucus river paints Era rows from the bounded date window',()=>{
  const river=buildPublicTimeLucusRiver(rows,{
    startDate:'2026-01-01',endDate:'2026-12-31'
  });
  assert.deepEqual(river.groups.map(row=>row.id),[
    'era:ERAAAAAA','time-undefined'
  ]);
  assert.ok(river.items.some(row=>row.entry_type==='era'&&row.group_key==='era:ERAAAAAA'));
  assert.equal(river.items.some(row=>row.uid==='DATE0003'),false);
  assert.deepEqual(river.items.filter(row=>row.group_key==='time-undefined')
    .map(row=>row.uid),['DATE0004']);
  assert.equal(river.items.some(row=>row.uid==='DATE0001'),false,
    'collapsed Era dates are represented by the Era range, not duplicated as unassigned points');
});

test('expanding an Era reveals its Period and real DateLucus points',()=>{
  const river=buildPublicTimeLucusRiver(rows,{
    startDate:'2026-01-01',endDate:'2026-12-31',expandedEras:['ERAAAAAA']
  });
  assert.ok(river.groups.some(row=>row.id==='period:ERAAAAAA:PERIOD1A'));
  assert.deepEqual(river.items.filter(row=>row.entry_type==='lucus'&&
    row.group_key==='period:ERAAAAAA:PERIOD1A').map(row=>row.uid),[
    'DATE0001','DATE0002'
  ]);
  assert.deepEqual(river.items.filter(row=>row.group_key==='time-undefined')
    .map(row=>row.uid),['DATE0004']);
});

test('bounded public TimeLucus query keeps hierarchy metadata and filters DateLucus only',()=>{
  const request={
    kind:'query',operation:'lucus-feature',scope:'lo3rwang',family:'time',mode:'public',
    types:['era','period','date'],dateStart:'2026-01-01',dateEnd:'2026-12-31'
  };
  const parsed=parseLucusFeatureQuery(request);
  assert.equal(parsed.dateStart,request.dateStart);
  assert.equal(parsed.dateEnd,request.dateEnd);
  assert.throws(()=>parseLucusFeatureQuery({...request,dateEnd:'2025-12-31'}));
  assert.throws(()=>parseLucusFeatureQuery({...request,dateEnd:undefined}));
  assert.throws(()=>parseLucusFeatureQuery({...request,family:'space',
    types:['trace','path','point']}));
});

test('Scope Culture restores two independent rivers and the suggested-Lucus lane',async()=>{
  const page=await source('app/loc/views/CulturePublicReader.jsx');
  assert.match(page,/items=\{lucusRiver\.items\} extraGroups=\{lucusRiver\.groups\}/);
  assert.match(page,/items=\{densityRiver\.items\} extraGroups=\{densityRiver\.groups\}/);
  assert.doesNotMatch(page,/unifiedRiver|scope-culture-unified-river/);
  assert.match(page,/dateStart:start,dateEnd:end/);
  assert.match(page,/groups:\[\.\.\.base\.groups,candidateLane\]/);
  assert.doesNotMatch(page,/selectedPeriodUid\)return;/);
  assert.match(page,/scopeId==='loc'\?<LocGroupCultureReader\/>:<ScopeCulturePublicReader\/>/);
  const groupReader=await source('app/loc/views/LocGroupCultureReader.jsx');
  assert.match(groupReader,/CultureTimeline/);
});
