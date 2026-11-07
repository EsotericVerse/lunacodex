/** Structural regression checks; animation fidelity/density still require visual QA on real devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORED_EFFECT_FILES,CANONICAL_RUNE_ENGLISH,RUNE_EFFECT_KEYS,
  RUNE_VFX_OVERLAYS,runeEffectFor
} from '../app/lrunes/effekseer/rune-effect-library.mjs';
import {EFFECT_ASSET_BLOBS} from './rune-effekseer-asset-manifest.mjs';
import {RETIRED_EFFECT_ASSETS} from './rune-effekseer-retired-assets.mjs';
import {posix,win32} from 'node:path';
import {resolvePinnedEffekseerTarget} from './pinned-effekseer-path.mjs';

const drawable=CANONICAL_RUNE_ENGLISH.filter(name=>name!=='Virtue');
const pinned=new Set(EFFECT_ASSET_BLOBS.map(asset=>asset.target));
const mxsPaths=Object.values(AUTHORED_EFFECT_FILES).filter(path=>path.startsWith('Collections/MAGICALxSPIRAL/MxS_'));

test('all 66 drawable runes use different complete authored scenes',()=>{
  assert.equal(drawable.length,66);
  const keys=drawable.map(name=>RUNE_EFFECT_KEYS[name]);
  assert.ok(keys.every(Boolean),'all drawable runes need an effect');
  assert.equal(new Set(keys).size,66,'main scenes must not be recycled');
  for(const key of keys){
    assert.ok(AUTHORED_EFFECT_FILES[key],`missing authored file for ${key}`);
    assert.doesNotMatch(key,/^(?:S:|SAMPLE:|B:|NS:)/,
      `a bare shader, basic or tutorial demo is not a finished rune scene: ${key}`);
  }
});

test('every runtime effect and overlay resolves to a pinned or bundled asset',()=>{
  for(const name of drawable){
    const runtime=runeEffectFor({english_name:name});
    assert.ok(runtime?.path,`unmapped ${name}`);
    assert.equal(runtime.path,'/vendor/effekseer/'+AUTHORED_EFFECT_FILES[RUNE_EFFECT_KEYS[name]]);
    for(const item of [runtime,...runtime.overlays]){
      const local=item.path.replace('/vendor/effekseer/','');
      if(local.startsWith('Collections/')){
        assert.ok(pinned.has(local.slice('Collections/'.length)),
          `unavailable author asset: ${name} -> ${local}`);
      }else{
        assert.ok(local.startsWith('Resources/') && local.endsWith('.efkefc'),
          `invalid bundled effect path: ${local}`);
      }
    }
  }
  for(const name of Object.keys(RUNE_VFX_OVERLAYS)){
    assert.ok(drawable.includes(name),`overlay on unknown rune: ${name}`);
  }
});

test('Flame has a dedicated authored fireball layer',()=>{
  const flame=runeEffectFor({english_name:'Flame'});
  assert.ok(flame.overlays.some(layer=>layer.role==='flame-projectile'
    && layer.key==='G:ef_fire01_projectile'));
});

test('every expanded MAGICAL X SPIRAL effect is pinned without duplicate entries',()=>{
  assert.equal(pinned.size,EFFECT_ASSET_BLOBS.length);
  for(const path of mxsPaths)assert.ok(pinned.has(path.slice('Collections/'.length)),`Missing MxS scene: ${path}`);
  const active=new Set(Object.values(AUTHORED_EFFECT_FILES)
    .filter(path=>path.startsWith('Collections/')).map(path=>path.slice('Collections/'.length)));
  const pinnedEffects=EFFECT_ASSET_BLOBS.filter(item=>item.target.endsWith('.efkefc')).map(item=>item.target);
  assert.deepEqual(pinnedEffects.slice().sort(),[...active].sort(),
    'pinned effects must equal the active 3D rune scenes and overlays');
  for(const item of RETIRED_EFFECT_ASSETS)assert.ok(!pinned.has(item.target),
    'retired asset must not be downloaded: '+item.target);
});

test('pinned Effekseer assets resolve safely on both Windows and POSIX',()=>{
  for(const [platform,root] of [
    [posix,'/loc/public/vendor/effekseer/Collections'],
    [win32,'C:\\loc\\public\\vendor\\effekseer\\Collections']
  ]){
    const entry='MAGICALxSPIRAL/MxS_Gohlem_Shield1.efkefc';
    assert.equal(resolvePinnedEffekseerTarget(root,entry,platform),platform.resolve(root,entry));
    for(const illegal of ['../outside.efkefc','../Collections-other/fake.png','.','']){
      assert.throws(()=>resolvePinnedEffekseerTarget(root,illegal,platform),
        /Unsafe Effekseer asset path/);
    }
    const absolute=platform===win32?'D:\\outside\\evil.efkefc':'/outside/evil.efkefc';
    assert.throws(()=>resolvePinnedEffekseerTarget(root,absolute,platform),
      /Unsafe Effekseer asset path/);
  }
});
