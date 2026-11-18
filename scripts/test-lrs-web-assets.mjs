import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {allowStaticSource,isLrsWebAsset} from './lrs-static-publish-rules.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('LOC Web and LOC IPA retain LOC pics and exclude game media',()=>{
 for(const p of ['pics/LOC-PicAll.webp','pics/LunaRunes.webp',
  'pics/01.soul.jpg','pics/64Card_org/source.png',
  'assets/pics/01.soul.jpg','assets/pics/LunaRunes.webp']){
  assert.equal(isLrsWebAsset(p),false,p);
  assert.equal(allowStaticSource(p),true,p);
 }
 for(const p of ['assets/lunarunes/cards/00.png',
  'assets/site/icons/lrunes-favicon.png','vendor/effekseer/effekseer.wasm',
  'vendor/rune-semantic-icons/66.svg','LunarRunesCardCut.pdf']){
  assert.equal(isLrsWebAsset(p),true,p);
  assert.equal(allowStaticSource(p),false,p);
 }
 const copy=read('scripts/copy-static-assets.mjs');
 assert.match(copy,/EXCLUDED_PICS_DIRS=native\?/);
 assert.match(copy,/fs\.cpSync\(picsSource,picsTarget/);
 assert.doesNotMatch(copy,/consume-lrs-ios-artifacts|rootDownloads/);
});
test('LOC builds from its own repo; CSS copies stay local',()=>{
 const pkg=JSON.parse(read('package.json'));
 const lock=JSON.parse(read('package-lock.json'));
 for(const script of ['prebuild','predev']){
  assert.doesNotMatch(pkg.scripts[script]||'',/restore-lrs-web-code|check-lrs-source-ownership/);
 }
 assert.equal(pkg.dependencies.three,undefined);
 assert.equal(lock.packages[''].dependencies.three,undefined);
 assert.equal(lock.packages['node_modules/three'],undefined);
 assert.equal(existsSync(new URL('../scripts/restore-lrs-web-code.mjs',import.meta.url)),false);
 for(const name of ['runes.css','home-runes.css']){
  const css=read('app/styles/'+name);
  assert.ok(css.length>100,'Local CSS copy must not be empty: '+name);
  assert.ok(read('app/globals.css').includes('./styles/'+name));
 }
 const ipa=read('.github/workflows/ios-device-build.yml');
 assert.doesNotMatch(ipa,/rune-source|lrs_commit|LRS_COMMIT|three@|consume-lrs|restore-lrs/);
});
test('lrunes remains a genuine LOC Scope with original content and pictures',()=>{
 const registry=read('app/modular/routing/scope-route-index.js');
 assert.match(registry,/"scope_id":"loc","domain":"loc\.lo3rwang\.cc"/);
 assert.match(registry,/"scope_id":"lrunes","domain":"lrunes\.lo3rwang\.cc"/);
 const home=read('app/lrunes/page.jsx');
 assert.match(home,/LocApp forcedView="home" forcedScope="lrunes"/);
 assert.doesNotMatch(home,/LrsWebRedirect/);
 const portal=read('app/loc/views/LrsPortalView.jsx');
 assert.match(portal,/ScopeEditableBlocks/);
 assert.match(portal,/scopeId="lrunes"/);
 assert.match(portal,/page="index"/);
 assert.match(portal,/RunesHomeBlockDisplay/);
 assert.doesNotMatch(portal,/location\.replace/);
 const blocks=read('app/loc/blocks/LocHomeBlockDisplay.jsx');
 assert.match(blocks,/const displayCustomUrl=customUrl/);
 assert.match(blocks,/src:SITE_IMAGES\.lunarunes/);
});
test('Game, card and daily URLs link to the independent LRS host',()=>{
 const redirect=read('app/loc/views/LrsWebRedirect.jsx');
 assert.match(redirect,/https:\/\/lrs\.lo3rwang\.cc/);
 const pages={
  'app/card/page.jsx':'/card/',
  'app/card/duel/page.jsx':'/card/duel/',
  'app/card/daily/page.jsx':'/card/daily/',
  'app/card/list/page.jsx':'/card/list/',
  'app/game/page.jsx':'/game/',
  'app/daily/page.jsx':'/daily/',
  'app/daily/log/page.jsx':'/daily/log/',
  'app/daily/trend/page.jsx':'/daily/trend/'
 };
 for(const [path,url] of Object.entries(pages)){
  const code=read(path);
  assert.match(code,/LrsWebRedirect/,path);
  assert.ok(code.includes('path="'+url+'"'),path);
  assert.doesNotMatch(code,/RuneUnifiedView|GameBoard|DailyLogClient|NEXT_PUBLIC_LOC_NATIVE_BUNDLE/);
 }
 const scope=read('app/modular/routing/scope-registry.js');
 assert.match(scope,/if\(!native\)return scopeHref\(scopeId,localPath\)/);
});
