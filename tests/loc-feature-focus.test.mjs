import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFeatureFocusState,
  featureFocusForScope,
  featureFocusReducer,
  featureFocusRangeFromRow,
  rowsWithinFeatureFocusRange
} from '../app/modular/feature-focus-state.mjs';

test('feature focus is visible only inside its owning Scope',()=>{
  const state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'trace',kind:'place',id:'A1B2C3D4',label:'台北車站'
  });

  assert.equal(featureFocusForScope(state,'loc').focus.id,'A1B2C3D4');
  assert.equal(featureFocusForScope(state,'lo3rwang'),null);
});

test('selecting a new focus clears the previous date range',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'trace',kind:'place',id:'A1B2C3D4',label:'台北車站'
  });
  state=featureFocusReducer(state,{
    type:'set-range',scopeId:'loc',startDate:'2026-03-01',endDate:'2026-03-31'
  });
  state=featureFocusReducer(state,{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'文章'
  });

  assert.equal(state.dateRange,null);
  assert.equal(state.focus.id,'E1F2G3H4');
});

test('invalid or cross-Scope ranges do not replace the current focus range',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'trace',kind:'place',id:'A1B2C3D4',label:'台北車站'
  });
  state=featureFocusReducer(state,{
    type:'set-range',scopeId:'loc',startDate:'2026-03-01',endDate:'2026-03-31'
  });
  const original=state;

  assert.equal(featureFocusReducer(state,{
    type:'set-range',scopeId:'lo3rwang',startDate:'2026-04-01',endDate:'2026-04-30'
  }),original);
  assert.equal(featureFocusReducer(state,{
    type:'set-range',scopeId:'loc',startDate:'2026-05-01',endDate:'2026-04-30'
  }),original);
  assert.deepEqual(state.dateRange,{startDate:'2026-03-01',endDate:'2026-03-31'});
});

test('clear removes focus and range for its owning Scope only',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'trace',kind:'place',id:'A1B2C3D4',label:'台北車站'
  });
  state=featureFocusReducer(state,{
    type:'set-range',scopeId:'loc',startDate:'2026-03-01',endDate:'2026-03-31'
  });

  assert.deepEqual(featureFocusReducer(state,{type:'clear',scopeId:'lo3rwang'}),state);
  assert.deepEqual(featureFocusReducer(state,{type:'clear',scopeId:'loc'}),
    createFeatureFocusState('loc'));
});

test('timeline rows publish an inclusive date range and filter only loaded dates locally',()=>{
  const rows=[
    {period:'2026/03/01',start_date:'2026-03-01',end_date:'2026-03-01',value:2},
    {period:'2026/03/02',start_date:'2026-03-02',end_date:'2026-03-02',value:4},
    {period:'2026/03/03',start_date:'2026-03-03',end_date:'2026-03-03',value:1}
  ];
  assert.deepEqual(featureFocusRangeFromRow(rows[1]),
    {startDate:'2026-03-02',endDate:'2026-03-02'});
  assert.deepEqual(rowsWithinFeatureFocusRange(rows,
    {startDate:'2026-03-02',endDate:'2026-03-02'}),[rows[1]]);
  assert.equal(rowsWithinFeatureFocusRange(rows,
    {startDate:'2025-03-02',endDate:'2025-03-31'}),rows);
});
