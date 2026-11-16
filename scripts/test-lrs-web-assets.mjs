import test from 'node:test';
import assert from 'node:assert/strict';
import {allowStaticSource,isLrsWebAsset} from '../scripts/lrs-static-publish-rules.mjs';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Web builds exclude only LRS-owned card, hero and effect assets',()=>{
 for(const p of ['assets/lunarunes/cards/00.png','assets/lunarunes/cards/66.png',
 'assets/pics/01.soul.jpg','assets/pics/LunaRunes.webp','assets/site/icons/lrunes-favicon.png',
 'vendor/effekseer/effekseer.wasm','vendor/effekseer/Collections/x.efkefc',
 'vendor/rune-semantic-icons/66.svg','LunarRunesCardCut.pdf']){
  assert.equal(isLrsWebAsset(p),true,p);assert.equal(allowStaticSource(p),false,p);
  assert.equal(allowStaticSource(p,{native:true}),true,p);
 }
 for(const p of ['assets/pics/LOC-PicAll.webp','assets/pics/lo3rwang-hero.jpg',
 'assets/site/icons/loc-favicon.png','assets/pics/LunArcus-1.png',
 'vendor/other-module/test.svg','assets/pics/moonriver.jpg']){
  assert.equal(isLrsWebAsset(p),false,p);assert.equal(allowStaticSource(p),true,p);
 }
});
test('Web Rune image and authored VFX paths point to LRS; IPA uses bundled paths',()=>{
 const src=read('app/lrunes/rune-asset-origin.mjs');
 assert.match(src,/LRS_WEB_ORIGIN='https:\/\/lrs\.lo3rwang\.cc'/);
 assert.match(src,/NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'\?'':LRS_WEB_ORIGIN/);
 const dir=read('app/lrunes/rune-directory.mjs');
 assert.match(dir,/runeAssetHref\(\x60\/assets\/lunarunes\/cards\//);
 assert(!dir.includes('LOC_ORIGIN'));
 assert.match(read('app/lrunes/effekseer/EffekseerStage.jsx'),/SOURCE=runeAssetHref\('\/vendor\/effekseer\/'\)/);
 assert.match(read('app/lrunes/effekseer/rune-effect-library.mjs'),/runeAssetHref\('\/vendor\/effekseer\/'/);
 assert.match(read('.github/workflows/ios-device-build.yml'),/LOC_NATIVE_RUNE_ASSETS: '1'[\s\S]*NEXT_PUBLIC_LOC_NATIVE_BUNDLE: '1'/);
 const copy=read('scripts/copy-static-assets.mjs');
 assert.match(copy,/native=process\.env\.LOC_NATIVE_RUNE_ASSETS==='1'/);
 assert.match(copy,/if\(!native\)/);
});
