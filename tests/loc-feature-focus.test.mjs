import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFeatureFocusState,
  featureFocusForScope,
  featureFocusReducer,
  featureFocusStatesReducer,
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

test('a single article remains the shared focus while another aspect is selected',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'文章',
    article:{uid:'E1F2G3H4',scopeId:'lo3rwang',title:'文章',date:'2026-03-12',placeUid:'A1B2C3D4'}
  });
  state=featureFocusReducer(state,{
    type:'select',scopeId:'loc',feature:'trace',kind:'place',id:'A1B2C3D4',label:'台北車站'
  });

  assert.equal(state.focus.id,'A1B2C3D4');
  assert.equal(state.article.uid,'E1F2G3H4');
  assert.equal(state.article.scopeId,'lo3rwang');
  assert.deepEqual(state.dateRange,{startDate:'2026-03-12',endDate:'2026-03-12'});
});

test('selecting the same article again preserves its place and source metadata',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'文章',
    article:{uid:'E1F2G3H4',scopeId:'lo3rwang',title:'文章',date:'2026-03-12',
      placeUid:'A1B2C3D4',placeTitle:'台北車站',source:'新聞來源'}
  });
  state=featureFocusReducer(state,{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'文章'
  });

  assert.equal(state.article.placeUid,'A1B2C3D4');
  assert.equal(state.article.placeTitle,'台北車站');
  assert.equal(state.article.source,'新聞來源');
  assert.deepEqual(state.dateRange,{startDate:'2026-03-12',endDate:'2026-03-12'});
});

test('an explicit article selection replaces same UID context from another Scope',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'甲文章',
    article:{uid:'E1F2G3H4',scopeId:'lo3rwang',title:'甲文章',placeUid:'A1B2C3D4'}
  });
  state=featureFocusReducer(state,{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'乙文章',
    article:{uid:'E1F2G3H4',scopeId:'scope2',title:'乙文章',placeUid:'J1K2L3M4'}
  });

  assert.equal(state.article.scopeId,'scope2');
  assert.equal(state.article.title,'乙文章');
  assert.equal(state.article.placeUid,'J1K2L3M4');
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

test('clearing a visit-day range preserves the article and selected aspect',()=>{
  let state=featureFocusReducer(createFeatureFocusState('loc'),{
    type:'select',scopeId:'loc',feature:'trace',kind:'article',id:'E1F2G3H4',label:'文章',
    article:{uid:'E1F2G3H4',scopeId:'lo3rwang',title:'文章',date:'2026-03-12'}
  });
  state=featureFocusReducer(state,{type:'clear-range',scopeId:'loc'});
  assert.equal(state.focus.feature,'trace');
  assert.equal(state.article.uid,'E1F2G3H4');
  assert.equal(state.dateRange,null);
});

test('article focus carries between Scope perspectives without losing its date',()=>{
  let states={loc:createFeatureFocusState('loc')};
  states=featureFocusStatesReducer(states,{
    type:'select',scopeId:'loc',feature:'search',kind:'article',id:'E1F2G3H4',label:'文章',
    article:{uid:'E1F2G3H4',scopeId:'lo3rwang',title:'文章',date:'2026-03-12'}
  });
  states=featureFocusStatesReducer(states,{type:'carry',fromScopeId:'loc',toScopeId:'lo3rwang',feature:'culture'});
  assert.equal(states.lo3rwang.focus.feature,'culture');
  assert.equal(states.lo3rwang.article.uid,'E1F2G3H4');
  assert.deepEqual(states.lo3rwang.dateRange,{startDate:'2026-03-12',endDate:'2026-03-12'});
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
