import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  MANAGEMENT_HERO_SLOTS,
  defaultHeroImageForPage,
  featureHeroDefaultImage,
  featureHeroPageFor,
  featureHeroImagePageFor,
  managementHeroDefaultImage,
  managementHeroImagePage,
  managementHeroSlot,
  defaultHeroCopyForPage,
  normalizeHeroCopyValue,
  sharedFeatureHeroFor,
} from '../app/loc/blocks/home-block-model.js';
import {heroImageUrlForPage} from '../app/loc/blocks/hero-image.mjs';
import {scopeConfigColumnList} from '../app/loc/scope/scope-config-fields.mjs';
import {
  LOC_MANAGEMENT_ROUTE_TABLE,
  managementRouteHref,
} from '../app/modular/routing/management-route-table.mjs';
import {PRIMARY_NAV_ORDER} from '../app/modular/routing/navigation-order.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {SITE_LUCUS_READ_MODE,readPublicSourceLucus,readPublicSourceTaxonomy} from '../app/loc/source/catalog-public.mjs';
import {queryLucusFeature} from '../app/loc/actions/lucus/queries.mjs';
import {readLocSourceHierarchy} from '../app/loc/actions/admin/queries.mjs';
import {traceSourceOptions} from '../app/modular/features/trace/trace-panel-filters.mjs';
import {blockWritePermissionKey,scopeBlockStoragePage} from '../app/loc/blocks/scope-block-storage-page.mjs';

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

test('the routing table resolves to the exact LOC and Scope Hero artwork',async()=>{
  const managementImages=Object.fromEntries(MANAGEMENT_HERO_SLOTS.map(slot=>
    [slot.key,managementHeroDefaultImage(slot).split('/').pop()]));
  assert.deepEqual(managementImages,{
    time:'LOC-culture.jpg',keywords:'LOC-statics.jpg',spatial:'LOC-gn.jpg',
    advanced:'LOC-search.jpg',system:'LOC-admin.jpg',members:'scope-manage.jpg',
    locKeywords:'LOC-statics.jpg',articles:'LOC-search.jpg'
  });
  const userImages={
    culture:'scope-culture.jpg',statics:'scope-statics.jpg',
    trace:'scope-gn.jpg',search:'scope-search.jpg'
  };
  for(const [feature,file] of Object.entries(userImages)){
    const page=featureHeroPageFor(feature);
    assert.equal(defaultHeroImageForPage('loc',page).split('/').pop(),file,feature);
    assert.equal(heroImageUrlForPage(null,'lo3rwang',page).split('/').pop(),file,feature);
    await readFile(new URL('../assets/pics/'+file,import.meta.url));
  }
  for(const slot of MANAGEMENT_HERO_SLOTS)
    await readFile(new URL('../assets/pics/'+managementImages[slot.key],import.meta.url));
  assert.equal(defaultHeroImageForPage('loc','group_admin').split('/').pop(),'LOC-admin.jpg');
  assert.equal(defaultHeroImageForPage('loc','GalaxyManage').split('/').pop(),'scope-manage.jpg');
  assert.equal(defaultHeroImageForPage('loc','group_setting').split('/').pop(),'local-setting.jpg');
});

test('Hero copy follows the requested management and public route labels',()=>{
  const titles={
    TimeLucus:'時間定錨',Groupkeyword:'關鍵詞',SpaceLucus:'空間定錨',
    GroupArticle:'文章管理',group_admin:'系統管理',GalaxyManage:'群組管理',
    group_culture:'文化',group_statics:'統計',group_trace:'痕跡',
    group_search:'搜尋',group_setting:'個人設定'
  };
  for(const [page,title] of Object.entries(titles))
    assert.equal(defaultHeroCopyForPage(page).title,title,page);
});

test('known cross-assigned artwork and internal Hero identifiers resolve to their route labels',()=>{
  assert.equal(heroImageUrlForPage({block_image:JSON.stringify({source:'custom',
    url:'https://loc.lo3rwang.cc/pics/scope-culture.jpg'})},'loc','SpaceLucus')
    .split('/').pop(),'LOC-gn.jpg');
  assert.equal(normalizeHeroCopyValue('Groupkeyword','title','ScopeKeyword'),'關鍵詞');
  assert.equal(normalizeHeroCopyValue('group_admin','title','group_admin'),'系統管理');
  assert.equal(normalizeHeroCopyValue('TimeLucus','title','LOC-culture.jpg'),'時間定錨');
  assert.equal(heroImageUrlForPage({block_image:JSON.stringify({source:'none',url:''})},
    'loc','group_trace').split('/').pop(),'scope-gn.jpg');
  const hero=sharedFeatureHeroFor([{block_order:1,block_eyebrow:'group_culture',
    block_title:'group_culture'}],'group_culture');
  assert.equal(hero.eyebrow,'Culture');
  assert.equal(hero.title,'文化');
});

test('Kysely Scope config reads receive column references rather than one CSV identifier',()=>{
  assert.deepEqual(scopeConfigColumnList('loc'),['id','display_name','locale']);
  assert.deepEqual(scopeConfigColumnList('lo3rwang'),[
    'id','display_name','search_intro','search_aliases','theme','locale',
    'search','statics','culture','trace'
  ]);
});

test('management route table preserves the Group and Scope destinations',()=>{
  assert.deepEqual(LOC_MANAGEMENT_ROUTE_TABLE.group,{
    system:'/admin/',
    members:'manage',
    keywords:'statics/manage',
    articles:'search/manage',
  });
  assert.deepEqual(LOC_MANAGEMENT_ROUTE_TABLE.scope,{
    time:'culture/manage',
    spatial:'trace/manage',
    keywords:'statics/manage',
    articles:'search/manage',
  });
  assert.deepEqual(Object.keys(LOC_MANAGEMENT_ROUTE_TABLE.group),[
    'system','members','keywords','articles'
  ]);
  assert.deepEqual(Object.keys(LOC_MANAGEMENT_ROUTE_TABLE.scope),[
    'time','spatial','keywords','articles'
  ]);
  assert.deepEqual(Object.keys(LOC_MANAGEMENT_ROUTE_TABLE.user),[
    'culture','trace','statics','search'
  ]);
  assert.deepEqual(PRIMARY_NAV_ORDER,[
    'home','culture','trace','statics','search','settings'
  ]);
  assert.ok(Object.values(LOC_MANAGEMENT_ROUTE_TABLE).flatMap(Object.values)
    .every(route=>!route.includes('?section=')));
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
  assert.equal(href,'/lo3rwang/trace/manage');
});

test('LOC governance copy is stored as governance while other Scope pages keep their own names',()=>{
  assert.equal(scopeBlockStoragePage('loc','trace'),'governance');
  assert.equal(scopeBlockStoragePage('LOC','Trace'),'governance');
  assert.equal(scopeBlockStoragePage('lo3rwang','trace'),'trace');
  assert.equal(scopeBlockStoragePage('loc','search'),'search');
  for(const page of ['group_admin','GalaxyManage','Groupkeyword','GroupArticle',
    'TimeLucus','ScopeKeyword','SpaceLucus','ScopeArticle'])
    assert.equal(scopeBlockStoragePage('loc',page),page);
});

test('public SiteLucus is available from resident publication without a SQL read',async()=>{
  assert.equal(SITE_LUCUS_READ_MODE,'published-js');
  assert.equal(PUBLISHED_SITE_BOOTSTRAP.site_lucus.length,36);
  assert.equal((await readPublicSourceLucus()).length,36);
  const taxonomy=await readPublicSourceTaxonomy();
  assert.equal(taxonomy.tree.length,36);
  assert.equal(taxonomy.roots.length,3);
  const admin=await readLocSourceHierarchy();
  assert.deepEqual(admin.data,await readPublicSourceLucus());
  const result=await queryLucusFeature({kind:'query',operation:'lucus-feature',
    scope:'loc',family:'source',mode:'public',types:['from'],limit:5,
    includeTotal:true});
  assert.equal(result.query.mode,'published-js');
  assert.equal(result.data.rows.length,5);
  assert.equal(result.data.hasMore,true);
  assert.equal(result.data.totalCount,
    (await readPublicSourceLucus()).filter(row=>row.type==='from').length);
});

test('Trace source options use the published SiteLucus tree and retain the Galaxy.site value',async()=>{
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

test('Group and Scope management routes share the mapped Hero rows',()=>{
  const group=MANAGEMENT_HERO_SLOTS.filter(slot=>slot.audience==='loc');
  const scope=MANAGEMENT_HERO_SLOTS.filter(slot=>slot.audience==='scope');
  assert.deepEqual(group.map(slot=>slot.key),['system','members','locKeywords','articles']);
  assert.deepEqual(group.map(slot=>slot.page),['group_admin','GalaxyManage','Groupkeyword','GroupArticle']);
  assert.deepEqual(scope.map(slot=>slot.key),['time','keywords','spatial','advanced']);
  assert.deepEqual(scope.map(slot=>slot.page),['TimeLucus','Groupkeyword','SpaceLucus','GroupArticle']);
  assert.equal(group.some(slot=>/time|space|trace/i.test(slot.key+' '+slot.page)),false);
  assert.equal(managementHeroSlot('keywordManage','loc')?.page,'Groupkeyword');
  assert.equal(managementHeroSlot('sourceManage','loc')?.page,'GalaxyManage');
  assert.equal(managementHeroSlot('manage','loc')?.page,'SpaceLucus');
  assert.equal(managementHeroSlot('timeManage','loc')?.page,'TimeLucus');
  assert.equal(managementHeroSlot('keywordManage','loc')?.page,'Groupkeyword');
  assert.equal(managementHeroSlot('searchManage','loc')?.page,'GroupArticle');
  assert.equal(managementHeroSlot('keywords','lo3rwang')?.page,'Groupkeyword');
  assert.equal(managementHeroSlot('manage','lo3rwang')?.page,'SpaceLucus');
  assert.equal(managementHeroSlot('searchManage','lo3rwang')?.page,'GroupArticle');
  assert.equal(managementHeroSlot('timeManage','lo3rwang')?.page,'TimeLucus');
});

test('admin Hero editor shows one management row followed by its public feature Hero',async()=>{
  const panel=await readFile(new URL('../app/loc/views/admin-panels/FeatureHeroImages.jsx',import.meta.url),'utf8');
  assert.match(panel,/id:'culture',[^\n]*managementKeys:\['time'\]/);
  assert.match(panel,/id:'statics',[^\n]*managementKeys:\['locKeywords'\]/);
  assert.match(panel,/id:'trace',[^\n]*managementKeys:\['spatial'\]/);
  assert.match(panel,/id:'search',[^\n]*managementKeys:\['articles'\]/);
  assert.match(panel,/\['system','members'\]/);
  assert.match(panel,/label:'個人設定'/);
  assert.doesNotMatch(panel,/managementKeys:\['locKeywords','keywords'\]|managementKeys:\['articles','advanced'\]/);
});

test('management Hero copy uses the fixed public display reader, not auth-gated SQL',async()=>{
  const queries=await readFile(new URL('../app/loc/actions/blocks/queries.mjs',
    import.meta.url),'utf8');
  assert.match(queries,/async function publicHeroBlocks\(types,\{scope='loc'\}=\{\}\)/);
  assert.match(queries,/return withPublicLocRead\(\{scope\},\(db,port\)=>read\(db,port,missing\)\)/);
  assert.match(queries,/MANAGEMENT_HERO_SLOTS\.map\(slot=>slot\.page\)/);
  assert.doesNotMatch(queries,/withAuthorizedLocRead/);
});

test('personal settings copy and image resolve to the same Group row',()=>{
  assert.equal(featureHeroPageFor('setting'),'group_setting');
  assert.equal(featureHeroImagePageFor('setting'),'group_setting');
});

test('feature Hero CSS follows the copy wrapper and keeps the heading one line',async()=>{
  const [component,styles]=await Promise.all([
    readFile(new URL('../app/modular/ui.jsx',import.meta.url),'utf8'),
    readFile(new URL('../app/styles/uiux.css',import.meta.url),'utf8')
  ]);
  assert.match(component,/className="scope-feature-hero-copy"/);
  assert.match(styles,/\.scope-feature-hero-copy>\.home-title-row\{[\s\S]*?grid-template-columns:max-content minmax\(0,1fr\)!important;/);
  assert.match(styles,/\) \.scope-feature-hero-copy>\.home-title-row>h1\{[\s\S]*?max-width:none!important;\s*white-space:nowrap;/);
  assert.match(styles,/\.scope-feature-hero--artwork\.scope-hero \.scope-feature-hero-copy>\.home-title-row>h1\{\s*color:#fff!important;/);
  assert.match(styles,/\.scope-feature-hero--artwork \.scope-feature-hero-copy>\.home-title-row>\.scope-subtitle\{color:#edf1f9!important\}/);
});

test('block editing reads authoritative SQL and reports denied write permissions',async()=>{
  const [queries,scopeData,editor]=await Promise.all([
    readFile(new URL('../app/loc/actions/blocks/queries.mjs',import.meta.url),'utf8'),
    readFile(new URL('../app/loc/scope/scope-data.js',import.meta.url),'utf8'),
    readFile(new URL('../app/loc/blocks/ScopeBlockEditorSession.jsx',import.meta.url),'utf8')
  ]);
  const liveReader=queries.slice(queries.indexOf('export async function queryLiveBlocks'),
    queries.indexOf('export async function readPublicHomePageCopy'));
  const displayReader=scopeData.slice(scopeData.indexOf('export async function selectScopeBlocks'));
  assert.match(liveReader,/withPublicLocRead\([\s\S]*?block_list\(/);
  assert.doesNotMatch(liveReader,/publicBlockList|readPublicHomeObject/);
  assert.match(scopeData,/selectLiveScopeBlocks[\s\S]*?queryLiveBlocks/);
  assert.match(editor,/selectLiveScopeBlocks\(scopeId,pageName\)/);
  assert.match(editor,/blockWritePermissionKey\(error,scopeId,pageName\)/);
  assert.match(displayReader,/queryBlocks\('block_list'/);
  assert.equal(blockWritePermissionKey({status:403},'loc','TimeLucus'),'globalPermissionDenied');
  assert.equal(blockWritePermissionKey({status:403},'lo3rwang','culture'),'editPermissionDenied');
  assert.equal(blockWritePermissionKey({status:401},'loc','TimeLucus'),'');
});
