import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGEMENT_HERO_SLOTS,
  featureHeroDefaultImage,
  featureHeroPageFor,
  managementHeroImagePage,
} from '../app/loc/blocks/home-block-model.js';
import {
  LOC_MANAGEMENT_ROUTE_TABLE,
  managementRouteHref,
} from '../app/modular/routing/management-route-table.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {readPublicSourceAnchors,readPublicSourceTaxonomy} from '../app/loc/source/catalog-public.mjs';

test('every management Hero keeps its image on its own copy row',()=>{
  for(const slot of MANAGEMENT_HERO_SLOTS)
    assert.equal(managementHeroImagePage(slot),slot.page,slot.key);
});

test('every functional Hero uses the Group page and its unique immediate fallback artwork',()=>{
  const features=['culture','statics','trace','search'];
  const images=features.map(id=>featureHeroDefaultImage(id));
  assert.deepEqual(features.map(featureHeroPageFor),features.map(id=>'group_'+id));
  assert.equal(new Set(images).size,features.length);
  assert.ok(images.every(Boolean));
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

test('public SiteAnchor is available from resident publication without a SQL read',async()=>{
  assert.equal(PUBLISHED_SITE_BOOTSTRAP.site_anchors.length,36);
  assert.equal((await readPublicSourceAnchors()).length,36);
  const taxonomy=await readPublicSourceTaxonomy();
  assert.equal(taxonomy.tree.length,36);
  assert.equal(taxonomy.roots.length,3);
});
