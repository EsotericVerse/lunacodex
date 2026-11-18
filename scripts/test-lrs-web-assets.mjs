import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {allowStaticSource,isLrsWebAsset} from './lrs-static-publish-rules.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('LOC Web never publishes LRS-owned media, native handoff stays separate',()=>{
 for(const p of ['assets/lunarunes/cards/00.png','assets/lunarunes/cards/66.png',
  'assets/pics/01.soul.jpg','assets/pics/LunaRunes.webp',
  'assets/site/icons/lrunes-favicon.png','vendor/effekseer/effekseer.wasm',
  'vendor/rune-semantic-icons/66.svg','LunarRunesCardCut.pdf']){
  assert.equal(isLrsWebAsset(p),true,p);
  assert.equal(allowStaticSource(p),false,p);
  assert.equal(allowStaticSource(p,{native:true}),true,p);
 }
 for(const p of ['assets/pics/LOC-PicAll.webp','assets/pics/lo3rwang-hero.jpg',
  'assets/site/icons/loc-favicon.png',
  'assets/pics/LunaRunes-hero.jpg','assets/pics/LunaRunes-hero_s.webp',
  'assets/pics/LunaRunesGame.jpg','pics/LunaRunes-hero.jpg',
  'pics/LunaRunes-hero_s.webp','pics/LunaRunesGame.jpg']){
  assert.equal(isLrsWebAsset(p),false,p);
  assert.equal(allowStaticSource(p),true,p);
 }
});
test('Web consumes LRS implementation only from a pinned Git commit',()=>{
 const cfg=JSON.parse(read('config/lrs-source.json'));
 assert.equal(cfg.repository,'EsotericVerse/lunarunes');
 assert.equal(cfg.releaseVersion,'1.0.2');
 assert.match(cfg.sourceCommit,/^[0-9a-f]{40}$/);
 const script=read('scripts/restore-lrs-web-code.mjs');
 assert.match(script,/sparse-checkout/);
 assert.match(script,/cfg\.sourceCommit/);
 assert.match(script,/LOC_NATIVE_RUNE_ASSETS/);
 assert.match(script,/LRS source symlink is forbidden/);
 assert.match(script,/wanted\.push\(rel\)/);
 const next=read('next.config.mjs');
 assert.match(next,/NEXT_PUBLIC_LRS_ASSET_ORIGIN/);
});
test('LOC renders original Rune Scope UI and keeps native source separate',()=>{
 const app=read('app/loc/LocApp.jsx');
 assert.match(app,/views\/LrsPortalView/);
 const portal=read('app/loc/views/LrsPortalView.jsx');
 assert.match(portal,/ScopeEditableBlocks/);
 assert.match(portal,/scopeId="lrunes"/);
 assert.match(portal,/page="index"/);
 assert.match(portal,/allowEditing/);
 assert.match(portal,/explicitEditButton/);
 assert.match(portal,/RunesHomeBlockDisplay/);
 assert.doesNotMatch(portal,/RunesClient|GenericScopeHomeView|location\.replace/);
 assert.doesNotMatch(portal,/location\.replace|lrs\.lo3rwang\.cc/);
 const home=read('app/lrunes/page.jsx');
 assert.match(home,/LocApp forcedView="home" forcedScope="lrunes"/);
 assert.doesNotMatch(home,/LrsWebRedirect/);
 const native=read('scripts/restore-lrs-native-ui.mjs');
 assert.match(native,/originalFiles/);
 assert.doesNotMatch(native,/import\('\.\.\/lrunes\/RunesClient'\)/);
 assert.match(native,/rel\.endsWith\('\/page\.jsx'\)/);
 assert.match(native,/LOC retains the same lrunes Scope homepage/);
 const ipa=read('.github/workflows/ios-device-build.yml');
 assert.match(ipa,/LOC_NATIVE_RUNE_ASSETS: '1'[\s\S]*NEXT_PUBLIC_LOC_NATIVE_BUNDLE: '1'/);
});
test('saved lrunes Scope image URLs and links are not rewritten to LRS',()=>{
 const src=read('app/loc/blocks/LocHomeBlockDisplay.jsx');
 assert.match(src,/const displayCustomUrl=customUrl/);
 assert.doesNotMatch(src,/rewriteRuneFeatureAnchors/);
 const web=read('scripts/restore-lrs-web-code.mjs');
 assert.match(web,/app\/lrunes\/RunesClient\.jsx/);
 const hero=read('app/loc/blocks/hero-image.mjs');
 assert.match(hero,/\['index','hero','game'\]\.includes\(pageName\)/);
});

test('LOC Rune asset origin adapter stays Web URL-only and native file-only',()=>{
 const src=read('app/lrunes/rune-asset-origin.mjs');
 assert.match(src,/LRS_WEB_ORIGIN='https:\/\/lrs\.lo3rwang\.cc'/);
 assert.match(src,/NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'\?'':LRS_WEB_ORIGIN/);
 const copy=read('scripts/copy-static-assets.mjs');
 assert.match(copy,/native=process\.env\.LOC_NATIVE_RUNE_ASSETS==='1'/);
 assert.match(copy,/if\(!native\)/);
 const view=read('app/loc/blocks/LocHomeBlockDisplay.jsx');
 assert.match(view,/src:\{src:runeAssetHref\(SITE_IMAGES\.lunarunes\.src\)\}/);
});

test('native and Web agree on the exact LRS source; retired module tree is forbidden',()=>{
 const cfg=JSON.parse(read('config/lrs-source.json'));
 const native=read('scripts/restore-lrs-native-ui.mjs');
 const web=read('scripts/restore-lrs-web-code.mjs');
 const ipa=read('.github/workflows/ios-device-build.yml');
 const verification=read('.github/workflows/verify-lrs-single-source.yml');
 assert.match(ipa,/readFileSync\('config\/lrs-source\.json','utf8'\)\)\.sourceCommit/);
 assert.doesNotMatch(ipa,/git ls-remote/);
 assert.match(verification,new RegExp('ref: '+cfg.sourceCommit));
 assert.match(native,/const sourceDirs=\['app\/lrunes','app\/card','app\/daily','app\/game','modules\/lrs'\]/);
 assert.doesNotMatch(web,/['"]modules\/lrune['"]/);
});

test('LOC git index retains no LRS-owned code or media after cutover',()=>{
 const result=spawnSync(process.execPath,['scripts/check-lrs-source-ownership.mjs'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
});

test('only standalone Rune card/game Web feature pages hand off to LRS',()=>{
 const routes={
  'app/card/page.jsx':'/card/',
  'app/card/duel/page.jsx':'/card/duel/',
  'app/card/daily/page.jsx':'/card/daily/',
  'app/card/list/page.jsx':'/card/list/',
  'app/game/page.jsx':'/game/'
 };
 for(const [path,destination] of Object.entries(routes)){
  const content=read(path);
  assert.match(content,/NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'/,path);
  assert.match(content,/LrsWebRedirect/,path);
  assert.ok(content.includes('path="'+destination+'"'),path);
 }
 const home=read('app/lrunes/page.jsx');
 assert.match(home,/LocApp forcedView="home" forcedScope="lrunes"/);
 assert.doesNotMatch(home,/LrsWebRedirect/);
 const portal=read('app/loc/views/LrsPortalView.jsx');
 assert.match(portal,/ScopeEditableBlocks/);
 assert.match(portal,/scopeId="lrunes"/);
 const registry=read('app/modular/routing/scope-registry.js');
 assert.match(registry,/if\(!native\)return scopeHref\(scopeId,localPath\)/);
 assert.doesNotMatch(registry,/scopeHref\('loc','lrunes\/'/);
});
test('LOC account Daily history is not substituted with LRS device-only data',()=>{
 const daily=read('app/daily/log/page.jsx');
 const native=read('scripts/restore-lrs-native-ui.mjs');
 assert.match(daily,/import DailyLogClient from '.\/DailyLogClient'/);
 assert.doesNotMatch(daily,/LrsWebRedirect/);
 assert.match(native,/const sourceDirs=.*'app\/daily'/);
});
