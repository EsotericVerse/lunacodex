import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import {HomeBlock} from '../app/loc/home-block-model.js';

const blocks=[{order:1,uid:'hero'},{order:2,uid:'second'},{order:3,uid:'third'}];
test('home Hero stays first; second cannot move over Hero',()=>{
  for(const page of ['index','hero']){
    assert.equal(HomeBlock.isPinnedHomeHero(page,blocks[0]),true);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,0,1),false);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,1,0),false);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,1,2),true);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,2,1),true);
  }
});
test('ordinary blocks may still change order',()=>{
  for(const page of ['search','trace','group_culture']){
    assert.equal(HomeBlock.isPinnedHomeHero(page,blocks[0]),false);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,0,1),true);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,1,0),true);
    assert.equal(HomeBlock.canSwapHomeBlockPositions(page,blocks,2,3),false);
  }
});

test('management Hero uses nine dedicated page_name documents, not group_manage orders',()=>{
  const scope=HomeBlock.MANAGEMENT_HERO_SLOTS.filter(x=>x.audience==='scope');
  const admin=HomeBlock.MANAGEMENT_HERO_SLOTS.filter(x=>x.audience==='loc');
  assert.equal(HomeBlock.MANAGEMENT_HERO_SLOTS.length,9);
  assert.deepEqual(scope.map(x=>[x.label,x.page,x.englishTitle]),[
    ['時間定錨','TimeAnchor','TimeAnchor'],
    ['關鍵詞','ScopeKeyword','ScopeKeyword'],
    ['空間定錨','SpaceAnchor','SpaceAnchor'],
    ['進階搜尋','ScopeAdvSearch','ScopeAdvSearch']
  ]);
  assert.deepEqual(admin.map(x=>[x.label,x.page]),[
    ['系統管理','scope_admin'],
    ['人員作品管理','GalaxyManage'],
    ['關鍵詞','Groupkeyword'],
    ['痕跡圖管理','GroupSpace'],
    ['文章管理','GroupArticle']
  ]);
  for(const slot of scope)assert.equal(HomeBlock.managementHeroImagePage(slot),'scope_manage');
  for(const slot of admin)assert.equal(HomeBlock.managementHeroImagePage(slot),
    slot.key==='system'?'scope_admin':slot.page);
  assert.deepEqual(admin.map(slot=>HomeBlock.managementHeroDefaultImage(slot)),[
    'https://loc.lo3rwang.cc/pics/LOC-admin.jpg',
    'https://loc.lo3rwang.cc/pics/LOC-culture.jpg',
    'https://loc.lo3rwang.cc/pics/LOC-statics.jpg',
    'https://loc.lo3rwang.cc/pics/LOC-gn.jpg',
    'https://loc.lo3rwang.cc/pics/LOC-search.jpg'
  ]);
  assert.equal(HomeBlock.managementHeroDefaultImage(scope[0]),'https://loc.lo3rwang.cc/pics/scope-gn.jpg');
  assert.equal(HomeBlock.MANAGEMENT_HERO_IMAGE_URL,'https://loc.lo3rwang.cc/pics/scope-gn.jpg');
  assert.equal(HomeBlock.featureHeroPageFor('admin'),'group_admin');
  assert.equal(HomeBlock.featureHeroPageFor('trace'),'group_trace');
  assert.doesNotMatch(readFileSync(new URL('../app/modular/published-blocks/index.js',import.meta.url),'utf8'),/group_governance/);
  assert.equal(HomeBlock.managementHeroSlot('/admin','loc'),null);
  assert.equal(HomeBlock.managementHeroSlot('/lo3rwang/culture/manage','lo3rwang',true,'culture')?.page,'TimeAnchor');
  assert.equal(HomeBlock.managementHeroSlot('/lo3rwang/statics/manage','lo3rwang',true,'statics')?.page,'ScopeKeyword');
  assert.equal(HomeBlock.managementHeroSlot('/lo3rwang/trace/manage','lo3rwang',true,'trace')?.page,'SpaceAnchor');
  assert.equal(HomeBlock.managementHeroSlot('/lo3rwang/search/manage','lo3rwang',true,'search')?.page,'ScopeAdvSearch');
  assert.equal(HomeBlock.managementHeroSlot('/search/manage','loc')?.page,'GroupArticle');
  assert.equal(HomeBlock.managementHeroSlot('/culture/manage','loc',true,'culture')?.page,'GalaxyManage');
  assert.equal(HomeBlock.managementHeroSlot('/statics/manage','loc',true,'statics')?.page,'Groupkeyword');
  assert.equal(HomeBlock.managementHeroSlot('/trace/manage','loc',true,'trace')?.page,'GroupSpace');
  const slot=scope[0];
  assert.equal(HomeBlock.managementHeroCopy([{block_order:1,block_title:'自訂時間錨點'}],slot).title,'自訂時間錨點');
});

test('Article Control and feature-aligned management Hero editor remain functional',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const articles=read('app/loc/SearchManagement.jsx');
  const spatial=read('app/loc/ScopeManagement.jsx');
  const hero=read('app/loc/views/admin-panels/FeatureHeroImages.jsx');
  const css=read('app/styles/uiux.css');
  for(const name of ["shortLabel:'文章管理'","shortLabel:'區塊修改'","shortLabel:'匯入'"])
    assert.ok(articles.includes(name),'Article Control is missing '+name);
  assert.match(articles,/ManagementArticlePublisher scopeId=\{scopeId\}/);
  assert.match(articles,/ManagementMediaWorkspace scopeId=\{scopeId\}/);
  assert.match(articles,/page="search" orders=\{\[1\]\}/);
  assert.match(articles,/page="trace"/);
  assert.doesNotMatch(articles,/ScopeOthersSources|label:'個人分類'/);
  assert.match(articles,/window\.location\.replace\('\/local\/settings\/\?section=features'\)/);
  const featurePrefs=read('app/loc/LocUserSettingsPanel.jsx');
  assert.match(featurePrefs,/keyword:data\.keyword\|\|'none'/);
  assert.match(read('app/AppShell.jsx'),/href:native\?'\/local\/settings\/index\.html':'\/local\/settings\/'/);
  assert.doesNotMatch(spatial,/section==='import'/);
  assert.doesNotMatch(spatial,/section==='others'/);
  assert.match(spatial,/requestedSection.*section/);
  assert.match(hero,/management-hero-copy-row/);
  assert.doesNotMatch(hero,/id:'manage',label:'頁面控管'/);
  assert.match(hero,/pageOverride="scope_manage"/);
  assert.doesNotMatch(hero,/['"]group_manage['"]/);
  assert.match(hero,/const page=slot\.page/);
  assert.match(hero,/page_name:page,block_order:1/);
  assert.match(hero,/pageOverride=\{HomeBlock\.managementHeroImagePage\(locSlot\)\}/);
  assert.match(hero,/defaultUrl=\{HomeBlock\.managementHeroDefaultImage\(locSlot\)\}/);
  // Five Admin feature tabs only; management Heroes and Personal Settings are
  // embedded inside their parent panels, not separate navigation buttons.
  const definitions=hero.match(/const FEATURES=Object\.freeze\((\[[\s\S]*?\])\.map\(feature=>/);
  assert.ok(definitions,'six feature definitions must be present');
  const features=Function('return '+definitions[1])();
  assert.deepEqual(features.map(({id,label,managementKey=null})=>[id,label,managementKey]),[
    ['culture','文化','time'],
    ['statics','統計','keywords'],
    ['trace','痕跡','spatial'],
    ['search','搜尋','advanced'],
    ['admin','系統管理',null]
  ]);
  assert.match(hero,/FEATURES\.map\(item=><button/);
  assert.doesNotMatch(hero,/FEATURE_GROUPS|management-time|management-keywords|management-spatial|management-advanced/);
  assert.match(hero,/<ScopeEditableBlocks/);
  assert.match(hero,/const scopeSlot=feature\.managementKey\?HomeBlock\.MANAGEMENT_HERO_SLOTS\.find/);
  assert.match(hero,/<h4>\{scopeSlot\.label\}<\/h4>/);
  assert.match(hero,/<ManagementHeroDetails slot=\{scopeSlot\} onDirtyChange=\{trackDirty\}\/>/);
  assert.match(hero,/const PERSONAL_SETTINGS_FEATURE=Object\.freeze/);
  assert.match(hero,/feature\.id==='admin'\?<section className="loc-card scope-inline-card" aria-label="個人設定"/);
  assert.match(hero,/page=\{HomeBlock\.featureHeroPageFor\(PERSONAL_SETTINGS_FEATURE\.id\)\}/);
  assert.match(hero,/<ImageSlot feature=\{PERSONAL_SETTINGS_FEATURE\} variant=\{SINGLE_VARIANT\[0\]\}/);
  assert.match(hero,/trackDirty\('setting-blocks',dirty\)/);
  assert.equal(HomeBlock.featureHeroPageFor('admin'),'group_admin');
  assert.equal(HomeBlock.featureHeroPageFor('setting'),'group_setting');
  assert.match(read('app/modular/ui.jsx'),/managementTextPage=managementSlot\?\.page/);
  assert.match(read('app/modular/ui.jsx'),/managementHeroImagePage\(managementSlot\)/);
  assert.match(read('app/modular/ui.jsx'),/managementHeroDefaultImage\(managementSlot\)/);
  assert.doesNotMatch(read('app/modular/ui.jsx'),/managementSlot\.audience==='loc'\?'https:\/\/loc\.lo3rwang\.cc\/pics\/LOC-admin\.jpg'/);
  assert.doesNotMatch(read('app/modular/ui.jsx'),/group_manage/);
  assert.match(read('app/loc/scope-data.js'),/const name=String\(page\|\|'index'\)\.trim\(\);/);
  assert.match(hero,/block_title:title/);
  assert.match(hero,/儲存 Hero 圖片路徑/);
  assert.match(hero,/儲存後資料庫讀回不一致/);
  assert.match(hero,/uid:HomeBlock.createUid\(\)/);
  const heroFrame=css.match(/\.scope-feature-hero\.scope-feature-hero--artwork\s*\{([^}]+)\}/)?.[1]||'';
  assert.match(heroFrame,/aspect-ratio:auto/);
  assert.match(heroFrame,/min-height:clamp\(290px,34vw,440px\)/);
  assert.match(heroFrame,/background-size:100% 100%,cover/);
  assert.match(heroFrame,/background-position:center center,center center/);
  assert.doesNotMatch(heroFrame,/contain|right center/);
  assert.match(css,/@media\(max-width:760px\)\{\s*\.scope-feature-hero\.scope-feature-hero--artwork\s*\{[^}]*min-height:clamp\(230px,56vw,335px\)/);
  assert.match(css,/--loc-type-hero-feature-title:clamp\(2\.25rem,3vw,3\.25rem\)/);
  assert.match(css,/--loc-type-hero-feature-title:clamp\(1\.625rem,1\.2rem \+ 2vw,2\.125rem\)/);
  assert.match(css,/--loc-type-hero-feature-subtitle:clamp\(1rem,\.95rem \+ \.35vw,1\.125rem\)/);
  assert.match(css,/--loc-type-hero-feature-copy:1rem/);
  // Against the established homepage minimums: functional headers must never
  // claim a taller default frame at common phone, tablet or desktop widths.
  const clamp=(min,fluid,max)=>Math.max(min,Math.min(fluid,max));
  for(const width of [320,375,430,560,760,768,1024,1280]){
    const feature=width<=760?clamp(230,width*.56,335):clamp(290,width*.34,440);
    const homepage=width<=760?clamp(460,width*1.18,570):clamp(430,width*.5,620);
    assert.ok(feature<homepage,`Feature Hero exceeds homepage at ${width}px`);
  }
  const activeHeightSelectors=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match=>match[1].includes('scope-feature-hero--')&&/min-height\s*:/.test(match[2]))
    .map(match=>match[1].replace(/\/\*[\s\S]*?\*\//g,'').trim());
  assert.deepEqual(activeHeightSelectors,['.scope-feature-hero.scope-feature-hero--artwork','.scope-feature-hero.scope-feature-hero--artwork']);
  assert.equal((css.match(/\.scope-feature-hero\.scope-feature-hero--artwork\s*\{/g)||[]).length,2);
  assert.ok(['culture','statics','search','trace','admin','manage','setting']
    .every(id=>Boolean(HomeBlock.FEATURE_HERO_ORDER[id])));
  assert.doesNotMatch(css,/data-loc-scope="loc"\] \.scope-feature-hero--manage\{--scope-feature-hero-image:url\('\.\.\/\.\.\/pics\/LOC-admin\.jpg'\)/);
  assert.match(css,/\.article-control-stacked/);
});

test('Article Control name is translated in all four UI dictionaries',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(read('app/AppShell.jsx'),/translateUiField\(activeLocale,'文章控管'\)/);
  for(const locale of ['zh_tw','zh_cn','en','ja'])
    assert.match(read('app/i18n/sections/fields.'+locale+'.js'),/"文章控管":/);
});

test('LOC and Author homepage entrance Motion animates only public block display, never BlockNote edit tree',()=>{
  const jsx=readFileSync(new URL('../app/loc/ScopeEditableBlocks.jsx',import.meta.url),'utf8');
  const style=readFileSync(new URL('../app/styles/loc-about-original.css',import.meta.url),'utf8');
  assert.ok(parse(jsx,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(jsx,/import \{motion,useReducedMotion\} from 'motion\/react'/);
  assert.match(jsx,/const motionHome=pageName==='index'&&\['loc','lo3rwang'\]\.includes\(scopeId\)&&SlotTag==='section'/);
  assert.match(jsx,/const HomeDisplayTag=motionHome\?motion\.section:SlotTag/);
  assert.match(jsx,/<HomeDisplayTag[\s\S]*?\.\.\.homeMotionProps\(slot\)/);
  assert.match(jsx,/slot\.order===1[\s\S]*?whileInView:/);
  assert.match(jsx,/viewport:\{once:true,amount:\.12\}/);
  assert.match(jsx,/initial:reduceMotion\?false:/);
  assert.match(jsx,/className="loc-home-motion-hero-line"/);
  assert.match(jsx,/<ScopeBlockDraftList/);
  assert.doesNotMatch(jsx,/<motion\.div[^>]*><ScopeBlockDraftList/);
  assert.match(style,/\.loc-home>\.loc-home-motion-block\{position:relative\}/);
  assert.match(style,/\.loc-home-motion-hero-line\{/);
  assert.match(style,/pointer-events:none/);
});

test('home entrances preserve sections, database blocks and editor save semantics',()=>{
  const src=readFileSync(new URL('../app/loc/ScopeEditableBlocks.jsx',import.meta.url),'utf8');
  assert.match(src,/const blocks=bootstrap\.data\?\.blocks/);
  assert.match(src,/const contents=<>/);
  assert.match(src,/return heroSlotOrder&&slot\.order===heroSlotOrder\?\[node,toggleButton\]:\[node\]/);
  assert.match(src,/Real Save never tears down an active Edit Dock on a management page/);
  // A homepage entrance Save finishes editing and returns through the Dock;
  // management pages keep their mounted editors. Pin both halves of that rule.
  assert.match(src,/const finishesHomeEntrance=pageName==='index'&&!keepEditorOpen&&!switching/);
  assert.match(src,/editDock\?\.active&&editDock\.scopeId===scopeId&&!finishesHomeEntrance/);
  assert.match(src,/return containerless\?contents:/);
  const about=readFileSync(new URL('../app/loc/views/AboutView.jsx',import.meta.url),'utf8');
  const author=readFileSync(new URL('../app/loc/AuthorHomeEditableBlock.jsx',import.meta.url),'utf8');
  assert.match(about,/renderDisplay=\{LocHomeBlockDisplay\}/);
  assert.match(author,/renderDisplay=\{AuthorHomeBlockDisplay\}/);
});
