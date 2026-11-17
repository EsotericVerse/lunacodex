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
  'assets/site/icons/loc-favicon.png']){
  assert.equal(isLrsWebAsset(p),false,p);
  assert.equal(allowStaticSource(p),true,p);
 }
});
test('Web consumes LRS implementation only from a pinned Git commit',()=>{
 const cfg=JSON.parse(read('config/lrs-source.json'));
 assert.equal(cfg.repository,'EsotericVerse/lunarunes');
 assert.equal(cfg.releaseVersion,'1.01R');
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
test('LOC hosts only a Web LRS route handoff; IPA restores native LRS UI',()=>{
 const portal=read('app/loc/LocApp.jsx');
 assert.match(portal,/views\/LrsPortalView/);
 assert.doesNotMatch(portal,/import\('\.\.\/lrunes\/RunesClient'\)/);
 const web=read('app/loc/views/LrsWebRedirect.jsx');
 assert.match(web,/lrs\.lo3rwang\.cc/);
 const native=read('scripts/restore-lrs-native-ui.mjs');
 assert.match(native,/originalFiles/);
 assert.match(native,/RunesClient/);
 assert.match(native,/rune-source|LRS checkout/);
 const ipa=read('.github/workflows/ios-device-build.yml');
 assert.match(ipa,/LOC_NATIVE_RUNE_ASSETS: '1'[\s\S]*NEXT_PUBLIC_LOC_NATIVE_BUNDLE: '1'/);
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

test('LOC Web rune handoff routes import no native 3D/card runtime',()=>{
 for(const path of ['app/lrunes/page.jsx','app/card/page.jsx',
   'app/card/duel/page.jsx','app/card/list/page.jsx','app/card/daily/page.jsx']){
   const src=read(path);
   assert.match(src,/LrsWebRedirect/,'LOC Web keeps a URL handoff: '+path);
   assert.doesNotMatch(src,/^import .*?(?:RuneUnifiedView|Rune3DNav|LocApp|JsonLd)/m,
     'No native Rune UI module should enter a Web redirect: '+path);
 }
});

test('LOC account Daily history is not substituted with LRS device-only data',()=>{
 const daily=read('app/daily/log/page.jsx');
 const native=read('scripts/restore-lrs-native-ui.mjs');
 assert.match(daily,/import DailyLogClient from '.\/DailyLogClient'/);
 assert.doesNotMatch(daily,/LrsWebRedirect/);
 assert.match(native,/const sourceDirs=.*'app\/daily'/);
});
