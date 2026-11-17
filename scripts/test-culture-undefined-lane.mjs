import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildEraRiver,unassignedPublicDateAnchors} from '../app/loc/culture/time-trace-river.mjs';

const anchor=(uid,date='2026-01-01')=>({
  uid,scope_id:'lo3rwang',entry_type:'anchor',start_date:date,title:uid
});

for(const editorOnly of [false,true]){
  const view=editorOnly?'management':'public';
  test(view+' always shows the bottom 未定義 lane with no records',()=>{
    const {items,groups}=buildEraRiver([],[],{editorOnly,scopeId:'lo3rwang'});
    assert.deepEqual(items,[]);
    assert.equal(groups.at(-1)?.label,'未定義');
    assert.equal(groups.at(-1)?.id,'time-undefined:lo3rwang');
  });
  test(view+' retains undetermined DateAnchors in the bottom lane',()=>{
    const {items,groups}=buildEraRiver([anchor('standalone')],[],{editorOnly,scopeId:'lo3rwang'});
    assert.equal(groups.at(-1)?.label,'未定義');
    const row=items.find(item=>item.uid==='standalone');
    assert.ok(row);
    assert.equal(row.group_key,'time-undefined:lo3rwang');
    assert.equal(row.start_date,'2026-01-01');
  });
  test(view+' shows assigned DateAnchors only in their era lane',()=>{
    const trace={uid:'era1',scope_id:'lo3rwang',entry_type:'era',
      title:'時代甲',start_date:'2026-01-01',end_date:'2026-02-01',
      ranges:[{start_date:'2026-01-01',end_date:'2026-02-01'}],anchor_ids:[]};
    const {items,groups}=buildEraRiver([trace,anchor('inside','2026-01-15'),
      anchor('outside','2026-03-01')],[],{editorOnly,scopeId:'lo3rwang'});
    assert.equal(groups.at(-1)?.label,'未定義');
    const undefinedRows=items.filter(item=>item.group_key==='time-undefined:lo3rwang');
    assert.deepEqual(undefinedRows.map(item=>item.uid),['outside']);
  });
}

test('public Scope Culture puts only out-of-era DateAnchors on the final 未定義 lane',()=>{
  const dates=[
    {uid:'first',date:'2026-01-10'},
    {uid:'gap',date:'2026-02-10'},
    {uid:'second',date:'2026-03-10'},
    {uid:'outside',date:'2026-05-10'},
    {uid:'undated',date:''}
  ];
  // Disjoint periods must not make the gap a continuous era interval.
  const windows=[{start:'2026-01-01',end:'2026-01-31'},
    {start:'2026-03-01',end:'2026-03-31'}];
  assert.deepEqual(unassignedPublicDateAnchors(dates,windows).map(row=>row.uid),
    ['gap','outside']);
  assert.deepEqual(unassignedPublicDateAnchors(dates,[]).map(row=>row.uid),
    ['first','gap','second','outside']);
});
