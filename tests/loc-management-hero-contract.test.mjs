import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGEMENT_HERO_SLOTS,
  managementHeroImagePage,
} from '../app/loc/blocks/home-block-model.js';
import {
  LOC_MANAGEMENT_ROUTE_TABLE,
  managementRouteHref,
} from '../app/modular/routing/management-route-table.mjs';

test('every management Hero keeps its image on its own copy row',()=>{
  for(const slot of MANAGEMENT_HERO_SLOTS)
    assert.equal(managementHeroImagePage(slot),slot.page,slot.key);
});

test('management route table preserves the Group and Scope destinations',()=>{
  assert.deepEqual(LOC_MANAGEMENT_ROUTE_TABLE.group,{
    system:'/admin/',
    keywords:'statics/manage',
    members:'manage',
    articles:'search/manage?section=publish&edit=1',
  });
  assert.deepEqual(LOC_MANAGEMENT_ROUTE_TABLE.scope,{
    time:'culture/manage',
    keywords:'statics/manage',
    spatial:'trace/manage?section=anchor',
    articles:'search/manage?section=publish',
  });
});

test('Scope management route uses the active Scope context',()=>{
  const calls=[];
  const href=managementRouteHref('scope','spatial','lo3rwang',{
    navigate:(scope,path)=>{
      calls.push({scope,path});
      return '/'+scope+'/'+path;
    },
  });
  assert.deepEqual(calls,[{scope:'lo3rwang',path:'trace/manage'}]);
  assert.equal(href,'/lo3rwang/trace/manage?section=anchor');
});
