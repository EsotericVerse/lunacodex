import test from 'node:test';
import assert from 'node:assert/strict';
import {heroAssetMode,heroAssetName,serveHeroAsset} from '../app/loc/blocks/hero-assets.mjs';
const name='LOC-PicAll.webp';
const sourceHashes={[name]:'original'};
const request=(path='/pics/'+name,init)=>new Request('https://loc.lo3rwang.cc'+path,init);
const local={fetch:async()=>new Response('local',{headers:{'content-type':'image/webp'}})};
const bucket={async get(){return {etag:'original',size:2,body:new Response('r2').body};},
  async head(){return {etag:'original',size:2};}};
test('R2 serves the exact mirrored image without touching local assets',async()=>{
  const env={LOC_HERO_ASSETS:bucket,ASSETS:{fetch(){throw Error('unexpected fallback');}}};
  const response=await serveHeroAsset(request(),env,sourceHashes);
  assert.equal(await response.text(),'r2');
  assert.equal(response.headers.get('content-type'),'image/webp');
  const head=await serveHeroAsset(request(undefined,{method:'HEAD'}),env,sourceHashes);
  assert.equal(head.headers.get('content-length'),'2');
  assert.equal(await head.text(),'');
  const notModified=await serveHeroAsset(request(undefined,{headers:{'if-none-match':'"original"'}}),env,sourceHashes);
  assert.equal(notModified.status,304);
});
test('unbound, disabled, failed, missing or stale R2 uses local images',async()=>{
  for(const env of [
    {ASSETS:local},{ASSETS:local,LOC_HERO_ASSET_MODE:'local',LOC_HERO_ASSETS:bucket},
    {ASSETS:local,LOC_HERO_ASSETS:{get:async()=>{throw Error('offline');}}},
    {ASSETS:local,LOC_HERO_ASSETS:{get:async()=>null}},
    {ASSETS:local,LOC_HERO_ASSETS:{get:async()=>({etag:'old',body:new Response('old').body})}}
  ])assert.equal(await (await serveHeroAsset(request(),env,sourceHashes)).text(),'local');
});
test('only exact existing public Hero image paths enter R2',async()=>{
  assert.equal(heroAssetMode('local'),'local');
  assert.equal(heroAssetName('/pics/'+name),name);
  for(const path of ['/pics/LOC-admin.jpg','/pics/control.json','/other/'+name,'/pics/%2e%2e/'+name])
    assert.equal(await serveHeroAsset(request(path),{LOC_HERO_ASSETS:bucket},sourceHashes),null);
  assert.equal(await serveHeroAsset(request(undefined,{method:'POST'}),{LOC_HERO_ASSETS:bucket},sourceHashes),null);
});
