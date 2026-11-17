import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLocCultureScopePreview} from '../app/loc/culture/loc-scope-preview.mjs';

const fixture={
  scopes:[{id:'scope1'},{id:'scope2'},{id:'scope3'}],
  scopeRanges:[
    {scope_id:'scope1',start_date:'2026-11-15',item_count:5},
    {scope_id:'scope1',start_date:'2026-11-16',item_count:3},
    {scope_id:'scope2',start_date:'2026-11-15',item_count:2}
  ],
  sourceScopeGroups:[
    {code:'threads',scope_id:'scope1',category:'Threads',item_count:5},
    {code:'ig',scope_id:'scope1',category:'Instagram',item_count:3},
    {code:'threads',scope_id:'scope2',category:'Threads',item_count:2}
  ],
  sourceScopeRiverItems:[
    {scope_id:'scope1',source_code:'threads',start_date:'2026-11-15',item_count:5},
    {scope_id:'scope1',source_code:'ig',start_date:'2026-11-16',item_count:3},
    {scope_id:'scope2',source_code:'threads',start_date:'2026-11-15',item_count:2}
  ]
};

test('LOC Culture root groups are Scope IDs, not site categories',()=>{
  const result=buildLocCultureScopePreview(fixture);
  assert.deepEqual(result.groups.map(row=>row.id),
    ['loc-preview:scope1','loc-preview:scope2','loc-preview:scope3']);
  assert.ok(result.groups.every(row=>row.collapsible));
  assert.equal(result.groups[0].label,'scope1（8）');
  assert.equal(result.groups[1].label,'scope2（2）');
  assert.equal(result.groups[2].label,'scope3（0）');
  assert.ok(result.items.every(row=>!row.group_key.includes(':source:')));
});

test('expanding Scope reveals only its numeric source preview',()=>{
  const result=buildLocCultureScopePreview({...fixture,expandedScopeIds:['scope1']});
  assert.deepEqual(result.groups.map(row=>row.id),
    ['loc-preview:scope1','loc-preview:scope1:source:ig',
      'loc-preview:scope1:source:threads','loc-preview:scope2','loc-preview:scope3']);
  assert.equal(result.items.filter(row=>row.group_key.includes(':source:')).length,2);
  assert.ok(result.items.every(row=>
    !row.group_key.includes('loc-preview:scope2:source:')));
});

test('preview rejects numeric rows from Scopes outside the group',()=>{
  const result=buildLocCultureScopePreview({...fixture,
    scopeRanges:[...fixture.scopeRanges,{scope_id:'external',start_date:'2026-11-15',item_count:500}]});
  assert.ok(!result.groups.some(row=>row.id.includes('external')));
  assert.ok(!result.items.some(row=>row.scope_id==='external'));
});

test('LOC preview time is locked, Scope time rivers retain full navigation',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const timeline=readFileSync(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.match(culture,/windowStart=\{locSourceStart\}[\s\S]*fixedMin=\{locSourceStart\}[\s\S]*fixedMax=\{locSourceEnd\}[\s\S]*readOnlyViewport/);
  assert.match(timeline,/readOnlyViewport=false/);
  assert.match(timeline,/zoomable:!readOnlyViewport/);
  assert.match(timeline,/moveable:!readOnlyViewport/);
  assert.match(timeline,/preserveTimelineInstance=heightVariant==='double'\|\|mode==='trace'\|\|readOnlyViewport/);
  assert.match(timeline,/!readOnlyViewport\?<div className='scope-timeline-controls'/);
  assert.match(culture,/featureNavigationHref\(id,'culture'\)/);
  assert.doesNotMatch(culture,/近一年 · 各 Scope 文化預覽|左側依 Scope 分組/);
});
