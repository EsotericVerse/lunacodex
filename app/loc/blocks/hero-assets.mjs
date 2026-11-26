// The source images remain in assets/pics. R2 is an optional Web delivery mirror.
export const HERO_ASSET_MODE='r2';
export const HERO_R2_NAMES=Object.freeze([
  'LOC-PicAll.webp','LOC-PicAll_s.webp','LunaRunes-hero.jpg','LOC-culture.jpg',
  'aboutme.webp','scope-gn.jpg','LOC-statics.jpg','LOC-gn.jpg','LOC-search.jpg',
  'LOC-admin.jpg','scope-culture.jpg','scope-statics.jpg','scope-search.jpg',
  'scope-manage.jpg','local-setting.jpg'
]);
const allowed=new Set(HERO_R2_NAMES);
export function heroAssetMode(value){
  return value==='local'||HERO_ASSET_MODE==='local'?'local':'r2';
}
export function heroAssetName(pathname){
  const name=String(pathname||'').replace(/^\/pics\//,'');
  return pathname==='/pics/'+name&&allowed.has(name)?name:null;
}
export function heroMime(name){return name.endsWith('.webp')?'image/webp':'image/jpeg';}

// Only the existing, explicitly published image paths may read the private bucket.
// A changed source hash, missing object, unbound R2 or R2 error all use Static Assets.
export async function serveHeroAsset(request,env,sourceHashes){
  const name=heroAssetName(new URL(request.url).pathname);
  if(!name||!['GET','HEAD'].includes(request.method))return null;
  const mode=heroAssetMode(env.LOC_HERO_ASSET_MODE);
  const bucket=env.LOC_HERO_ASSETS;
  const expected=sourceHashes?.[name];
  if(mode==='r2'&&bucket&&expected){
    try{
      const object=request.method==='HEAD'?await bucket.head(name):await bucket.get(name);
      if(object&&object.etag===expected&&(request.method==='HEAD'||object.body)){
        const etag=object.httpEtag||'"'+object.etag+'"';
        const headers=new Headers({'content-type':heroMime(name),
          'cache-control':'public, max-age=3600, s-maxage=3600',
          'etag':etag,'access-control-allow-origin':'*','x-content-type-options':'nosniff'});
        if(request.headers.get('if-none-match')?.split(',').some(value=>
          value.trim()==='*'||value.trim().replace(/^W\//,'')===etag)){
          if(object.body)await object.body.cancel().catch(()=>{});
          return new Response(null,{status:304,headers});
        }
        headers.set('content-length',String(object.size));
        return new Response(request.method==='HEAD'?null:object.body,{headers});
      }
      if(object?.body)await object.body.cancel().catch(()=>{});
    }catch{/* R2 is optional; the portable asset is still available. */}
  }
  if(!env.ASSETS?.fetch)return null;
  const fallback=await env.ASSETS.fetch(request);
  if(mode==='local'||!fallback.ok)return fallback;
  // Do not keep a transient fallback cached for the full R2 image lifetime.
  const headers=new Headers(fallback.headers);
  headers.set('cache-control','public, max-age=60');
  return new Response(fallback.body,{status:fallback.status,statusText:fallback.statusText,headers});
}
