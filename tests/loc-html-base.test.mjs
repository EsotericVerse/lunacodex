import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../app/',import.meta.url);
function pageSources(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap(x=>
    x.isDirectory()?pageSources(join(dir,x.name)):
      x.name==='page.html'?[join(dir,x.name)]:[]);
}
const authored=pageSources(new URL(root).pathname);
const build=readFileSync(new URL('../scripts/build-loc-static.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('../app/loc/runtime/html-entry.jsx',import.meta.url),'utf8');
const render=readFileSync(new URL('../scripts/render-public-home.jsx',import.meta.url),'utf8');
const check=readFileSync(new URL('../scripts/verify-loc-output.mjs',import.meta.url),'utf8');
test('native HTML pages contain their own feature slot',()=>{
  assert.match(build,/renderPublicFeatureFrame/);
  assert.match(render,/id="loc-interactive-root"/);
  assert.match(render,/PublicNavigation scopeId/);
  assert.match(render,/PublicDock scopeId/);
  assert.doesNotMatch(build,/entry-'\+i\+'\.jsx/);
  assert.match(check,/Per-page React entrypoint emitted/);
});
test('on-demand React does not mount an AppShell or a router',()=>{
  assert.match(entry,/document\.body\.dataset/);
  assert.match(entry,/document\.getElementById\('loc-interactive-root'\)/);
  assert.match(entry,/createRoot\(node\)/);
  assert.doesNotMatch(entry,/import AppShell/);
  assert.match(entry,/LocFeature/);
  assert.match(entry,/PhoneWorkspace/);
  assert.match(entry,/ExtensionBridge/);
});
test('all three Scope homepages use one live Blocks reader after static navigation',()=>{
  const home=readFileSync(new URL('../app/loc/runtime/public-home-entry.jsx',import.meta.url),'utf8');
  const display=readFileSync(new URL('../app/loc/runtime/public-home-entry.jsx',import.meta.url),'utf8');
  assert.match(render,/id="loc-home-sql-slot"/);
  assert.match(render,/routes\/home\.js/);
  assert.doesNotMatch(render,/published-blocks\/(?:loc|lrunes|lo3rwang)\/index/);
  assert.match(home,/kind:'block_list'/);
  assert.match(home,/credentials:'omit'/);
  assert.match(home,/new AbortController\(\)/);
  assert.match(display,/HomeBlock\.rows\(rows,'index'/);
});
test('every LOC feature renders into its fixed header and content DIVs',()=>{
  const feature=readFileSync(new URL('../app/modular/ui.jsx',import.meta.url),'utf8');
  const loc=readFileSync(new URL('../app/loc/LocApp.jsx',import.meta.url),'utf8');
  assert.match(render,/id="loc-feature-main"/);
  assert.match(render,/id="loc-feature-hero-canvas"/);
  assert.match(render,/data-loc-canvas="content"/);
  assert.match(feature,/<ExistingHero canvas=\{heroCanvas\}>/);
  assert.match(feature,/hero_block\(\[groupHeroPage,scopeHeroPage\]\)/);
  assert.doesNotMatch(feature,/PUBLISHED_HERO_ROWS/);
  assert.match(feature,/if\(heroCanvas\)return/);
  assert.match(feature,/useFixedPageCanvas/);
  assert.match(loc,/document\.getElementById\('loc-feature-hero-canvas'\)/);
  assert.match(check,/Missing fixed LOC DIV canvas/);
});
test('fixed DIV canvas is reused by custom Scope and device-local pages',()=>{
  const generic=readFileSync(new URL('../app/loc/views/GenericScopeHomeView.jsx',import.meta.url),'utf8');
  const local=readFileSync(new URL('../app/loc/local/Workspace.jsx',import.meta.url),'utf8');
  const shared=readFileSync(new URL('../app/loc/runtime/fixed-canvas.jsx',import.meta.url),'utf8');
  assert.match(generic,/<FeaturePage featureId="home"/);
  assert.doesNotMatch(generic,/return <main className="scope-main"/);
  assert.match(local,/useFixedPageCanvas/);
  assert.match(render,/\['loc','settings','features','phone'\]/);
  assert.match(local,/<ExistingHero canvas=\{heroCanvas\}>/);
  assert.match(shared,/document\.getElementById\('loc-feature-main'\)/);
  assert.match(shared,/document\.getElementById\('loc-interactive-root'\)/);
});
test('public data is queried after the frame, never from bundled Block snapshots',()=>{
  const scope=readFileSync(new URL('../app/loc/scope/scope-data.js',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../app/loc/runtime/app-bootstrap.js',import.meta.url),'utf8');
  const blocks=readFileSync(new URL('../app/loc/blocks/ScopeEditableBlocks.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(scope,/hasPublishedBlocks\(id,name\)/);
  assert.doesNotMatch(bootstrap,/loadPublishedBlocks/);
  assert.doesNotMatch(blocks,/loadPublishedBlocks/);
  assert.match(blocks,/selectScopeBlocks\(scopeId,pageName\)/);
});
test('the original six-key menu is reused for management without a second portal',()=>{
  assert.match(entry,/links\.length!==6/);
  assert.match(entry,/link\.dataset\.locMenuMode='management'/);
  assert.match(entry,/restore of restoration/);
  assert.doesNotMatch(entry,/scope-edit-dock-actions/);
});
test('entry authorization begins after the fixed Hero has settled',()=>{
  const hero=readFileSync(new URL('../app/loc/runtime/fixed-canvas.jsx',import.meta.url),'utf8');
  const management=readFileSync(new URL('../app/loc/management/ManagementAccess.jsx',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../app/loc/views/AdminHomeView.jsx',import.meta.url),'utf8');
  const feature=readFileSync(new URL('../app/modular/ui.jsx',import.meta.url),'utf8');
  assert.match(hero,/loc-feature-hero-ready/);
  assert.match(management,/if\(!heroReady\)return undefined/);
  assert.match(admin,/useAccount\(\{enabled:heroReady\}\)/);
  assert.match(feature,/heroCanvas\.dataset\.locHeroReady='true'/);
});
test('LRS links are published HTML instead of React redirects',()=>{
  assert.match(build,/outbound\?'<script>/);
  assert.match(check,/LRS outbound HTML must link directly/);
});

test('every source route is an authored HTML document, not JSX',()=>{
  assert.equal(authored.length,80);
  for(const file of authored){
    assert.equal(existsSync(file.replace(/page\.html$/,'page.jsx')),false,file);
    const html=readFileSync(file,'utf8');
    assert.match(html,/<html lang="zh-Hant">/);
    assert.match(html,/<body data-loc-component="/);
    assert.match(html,/data-loc-view="/);
    assert.match(html,/data-loc-scope="/);
  }
  assert.match(build,/item\.name==='page.html'/);
  assert.doesNotMatch(build,/page\.jsx/);
});

test('iOS local lease stays bounded without a global application shell',()=>{
  assert.match(entry,/hasExpiredLocalDeadline\(\)/);
  assert.match(entry,/getLocalDeadline\(\)>0/);
  assert.match(entry,/stopLocalDeadline\(\)/);
  assert.match(entry,/window\.location\.replace\('\/local\/index\.html'\)/);
});

test('native static pages enforce local lease before mounting a feature',()=>{
  const theme=readFileSync(new URL('../app/modular/runtime/theme-bootstrap.mjs',import.meta.url),'utf8');
  assert.match(theme,/loc-device-local-core-until-v1/);
  assert.match(theme,/window\.location\.replace\('\/local\/index\.html'\)/);
  assert.match(theme,/window\.localStorage\.removeItem\(key\)/);
});

test('all eight conditional CSS palettes load; manual selections never persist',()=>{
  const theme=readFileSync(new URL('../app/modular/runtime/theme-bootstrap.mjs',import.meta.url),'utf8');
  const controls=readFileSync(new URL('../app/loc/runtime/html-controls.js',import.meta.url),'utf8');
  const build=readFileSync(new URL('../scripts/build-loc-static.mjs',import.meta.url),'utf8');
  const images=readFileSync(new URL('../app/site-images.js',import.meta.url),'utf8');
  assert.match(theme,/timeZone:'Asia\/Taipei'/);
  assert.match(theme,/loc-default-theme-id-v1/);
  assert.match(build,/Array\.from\(\{length:8\}/);
  assert.match(build,/loc-theme-palette-/);
  assert.doesNotMatch(controls,/loc-user-theme-selection-v1|loc-active-theme-id-v1/);
  assert.doesNotMatch(theme,/loc-user-theme-selection-v1/);
  assert.match(images,/locArchitectureAsset=\{src:'\/pics\/ChaosGalaxy\.webp'\}/);
});

test('page copy is loaded only for the requested route and selected locale',()=>{
  const controls=readFileSync(new URL('../app/loc/runtime/html-controls.js',import.meta.url),'utf8');
  const copy=readFileSync(new URL('../app/i18n/ui-copy.js',import.meta.url),'utf8');
  assert.match(copy,/loadUiLocale/);
  assert.match(copy,/pageLocaleRoute/);
  assert.doesNotMatch(controls,/loc-page-locale-once-v1/);
  assert.match(build,/data-page-language="zh-Hant"/);
  assert.doesNotMatch(render,/data-loc-data-source/);
  assert.doesNotMatch(entry,/DataSourceStatus/);
});

test('one LOC Web shell covers authored features, while home and native remain distinct',async()=>{
  const {sharedWebRoutes,shellRouteManifest,shellRouteBootstrap,
    sharedWebRedirects,sharedWebRobotsHeaders}
    =await import('../scripts/loc-shared-route-shell.mjs');
  const pages=[
    {route:'/',component:'loc',scope:'loc',view:'home',title:'首頁'},
    {route:'/culture/',component:'loc',scope:'loc',view:'culture',title:'文化'},
    {route:'/admin/',component:'loc',scope:'loc',view:'admin',
      title:'系統管理',noIndex:true},
    {route:'/lrunes/card/',component:'outbound',scope:'lrunes',view:'home',
      relative:'card'},
    {route:'/lo3rwang/',component:'loc',scope:'lo3rwang',view:'home'}
  ];
  assert.deepEqual(sharedWebRoutes(pages).map(page=>page.route),
    ['/culture/','/admin/']);
  const manifest=shellRouteManifest(pages);
  assert.equal(manifest['/culture/'].title,'文化');
  assert.equal(manifest['/admin/'].noIndex,true);
  assert.equal(manifest['/lrunes/card/'],undefined);
  const bootstrap=shellRouteBootstrap(pages);
  assert.match(bootstrap,/loc-shared-route-bootstrap/);
  assert.match(bootstrap,/locComponent=page.component/);
  assert.match(bootstrap,/locView=page.view/);
  assert.match(bootstrap,/loc-static-feature-title/);
  const redirects=sharedWebRedirects(pages);
  assert.match(redirects,/\/culture\/ \/_loc\/shell\.html 200/);
  assert.match(redirects,/\/culture \/_loc\/shell\.html 200/);
  assert.match(redirects,/\/lrunes\/card\/ https:\/\/lrs\.lo3rwang\.cc\/card\/ 302/);
  assert.match(sharedWebRobotsHeaders(pages),/\/admin\/\n  X-Robots-Tag: noindex, nofollow/);
});
