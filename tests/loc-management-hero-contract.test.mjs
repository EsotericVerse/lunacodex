import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGEMENT_HERO_SLOTS,
  featureHeroDefaultImage,
  featureHeroPageFor,
  featureHeroImagePageFor,
  managementHeroImagePage,
  managementHeroSlot,
} from '../app/loc/blocks/home-block-model.js';
import {
  LOC_MANAGEMENT_ROUTE_TABLE,
  managementRouteHref,
} from '../app/modular/routing/management-route-table.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {SITE_ANCHOR_READ_MODE,readPublicSourceAnchors,readPublicSourceTaxonomy} from '../app/loc/source/catalog-public.mjs';
import {queryAnchorFeature} from '../app/loc/actions/anchor/queries.mjs';
import {readLocSourceHierarchy} from '../app/loc/actions/admin/queries.mjs';
import {traceSourceOptions} from '../app/modular/features/trace/trace-panel-filters.mjs';

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
  assert.equal(SITE_ANCHOR_READ_MODE,'published-js');
  assert.equal(PUBLISHED_SITE_BOOTSTRAP.site_anchors.length,36);
  assert.equal((await readPublicSourceAnchors()).length,36);
  const taxonomy=await readPublicSourceTaxonomy();
  assert.equal(taxonomy.tree.length,36);
  assert.equal(taxonomy.roots.length,3);
  const admin=await readLocSourceHierarchy();
  assert.deepEqual(admin.data,await readPublicSourceAnchors());
  const result=await queryAnchorFeature({kind:'query',operation:'anchor-feature',
    scope:'loc',family:'source',mode:'public',types:['from'],limit:5,
    includeTotal:true});
  assert.equal(result.query.mode,'published-js');
  assert.equal(result.data.rows.length,5);
  assert.equal(result.data.hasMore,true);
  assert.equal(result.data.totalCount,
    (await readPublicSourceAnchors()).filter(row=>row.type==='from').length);
});

test('Trace source options use the published SiteAnchor tree and retain the Galaxy.site value',async()=>{
  const taxonomy=await readPublicSourceTaxonomy();
  const options=traceSourceOptions(taxonomy);
  const expected=taxonomy.categories.filter(row=>['domain','from'].includes(row.type));
  assert.equal(options.length,expected.length);
  assert.deepEqual(options.map(row=>row.uid),expected.map(row=>row.category_code));
  assert.ok(options.every(row=>row.value&&row.label.includes(row.value)));
  assert.ok(options.some(row=>row.type==='from'));
  assert.ok(options.some(row=>row.type==='domain'));
});

test('Group admin is one group_admin Hero row for both display and editing',()=>{
  const slot=managementHeroSlot('admin','loc');
  assert.equal(slot?.page,'group_admin');
  assert.equal(managementHeroImagePage(slot),'group_admin');
  assert.equal(featureHeroPageFor('admin'),'group_admin');
  assert.equal(featureHeroImagePageFor('admin'),'group_admin');
});

test('Group and Scope management Heroes remain separate and asymmetric',()=>{
  const group=MANAGEMENT_HERO_SLOTS.filter(slot=>slot.audience==='loc');
  const scope=MANAGEMENT_HERO_SLOTS.filter(slot=>slot.audience==='scope');
  assert.deepEqual(group.map(slot=>slot.key),['system','members','locKeywords','articles']);
  assert.deepEqual(group.map(slot=>slot.page),['group_admin','GalaxyManage','Groupkeyword','GroupArticle']);
  assert.deepEqual(scope.map(slot=>slot.key),['time','keywords','spatial','advanced']);
  assert.deepEqual(scope.map(slot=>slot.page),['TimeAnchor','ScopeKeyword','SpaceAnchor','ScopeArticle']);
  assert.equal(group.some(slot=>/time|space|trace/i.test(slot.key+' '+slot.page)),false);
  assert.equal(managementHeroSlot('keywordManage','loc')?.page,'Groupkeyword');
  assert.equal(managementHeroSlot('sourceManage','loc')?.page,'GalaxyManage');
  assert.equal(managementHeroSlot('manage','loc')?.page,'SpaceAnchor');
  assert.equal(managementHeroSlot('timeManage','loc')?.page,'TimeAnchor');
  assert.equal(managementHeroSlot('keywordManage','loc')?.page,'Groupkeyword');
  assert.equal(managementHeroSlot('searchManage','loc')?.page,'GroupArticle');
  assert.equal(managementHeroSlot('keywords','lo3rwang')?.page,'ScopeKeyword');
  assert.equal(managementHeroSlot('manage','lo3rwang')?.page,'SpaceAnchor');
  assert.equal(managementHeroSlot('searchManage','lo3rwang')?.page,'ScopeArticle');
  assert.equal(managementHeroSlot('timeManage','lo3rwang')?.page,'TimeAnchor');
});

test('personal settings copy and image resolve to the same Group row',()=>{
  assert.equal(featureHeroPageFor('setting'),'group_setting');
  assert.equal(featureHeroImagePageFor('setting'),'group_setting');
});
