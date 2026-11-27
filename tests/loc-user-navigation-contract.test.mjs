import test from 'node:test';
import assert from 'node:assert/strict';
import {PRIMARY_FEATURE_ORDER,PRIMARY_NAV_ORDER}
  from '../app/modular/routing/navigation-order.mjs';
import {tracePlaceDefaultTab} from '../app/modular/features/trace/trace-panel-filters.mjs';

test('the six primary controls keep the requested order without changing feature routes',()=>{
  assert.deepEqual(PRIMARY_NAV_ORDER,['home','culture','trace','statics','search','settings']);
  assert.deepEqual(PRIMARY_FEATURE_ORDER,['culture','trace','statics','search']);
  assert.deepEqual(PRIMARY_FEATURE_ORDER.map(id=>[id,id]),[
    ['culture','culture'],['trace','trace'],['statics','statics'],['search','search']
  ]);
});

test('map-selected places open their time view by default',()=>{
  assert.equal(tracePlaceDefaultTab(),'timeline');
});
