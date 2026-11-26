// Publish only LOC-owned images at /pics/ for Next dev, standard Next builds
// and static exports. The authoritative files remain at assets/pics/.
// This is a build-time copy, not a browser cache or an image import into JS.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {HERO_R2_NAMES,heroAssetMode} from '../app/loc/blocks/hero-assets.mjs';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'assets','pics');
const target=path.join(root,'public','pics');
const native=process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1';
const excluded=native?path.join(source,'64Card_org'):null;
// Standalone/local and iOS builds keep the full originals. Workers CI may
// package a compact visual fallback instead, but never requires R2 to render.
const slim=!native&&heroAssetMode(process.env.LOC_HERO_ASSET_MODE)==='r2'&&
  (process.env.LOC_HERO_ASSET_MODE==='r2'||Boolean(process.env.WORKERS_CI_BUILD_UUID));
const hashes={};
const mirrored=new Set(HERO_R2_NAMES.map(name=>path.join(source,name)));
if(!fs.existsSync(source))throw new Error('LOC images missing: '+source);
fs.rmSync(target,{recursive:true,force:true});
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.cpSync(source,target,{recursive:true,filter:entry=>
  (!excluded||(entry!==excluded&&!entry.startsWith(excluded+path.sep)))&&
  (!slim||!mirrored.has(entry))});
let saved=0;
const sharp=slim?(await import('sharp')).default:null;
for(const name of HERO_R2_NAMES){
  const input=path.join(source,name);
  if(!fs.existsSync(input))
    throw new Error('LOC Hero R2 source image missing: '+name);
  const original=fs.readFileSync(input);
  hashes[name]=createHash('md5').update(original).digest('hex');
  if(!slim)continue;
  // Cache the fallback bytes with the source hash, not the deployment ID.
  // Use the original if the encoder fails or cannot make it smaller.
  const cache=path.join(root,'.next','cache','loc-hero-fallback',
    'v1-'+hashes[name]+'-'+name);
  const output=path.join(target,name);
  let fallback=original;
  try{
    if(fs.existsSync(cache))fallback=fs.readFileSync(cache);
    else{
      const resized=sharp(original).resize({width:960,height:960,
        fit:'inside',withoutEnlargement:true});
      const compact=await (name.endsWith('.webp')?resized.webp({quality:78}):
        resized.jpeg({quality:78})).toBuffer();
      if(compact.length<original.length)fallback=compact;
      fs.mkdirSync(path.dirname(cache),{recursive:true});
      fs.writeFileSync(cache,fallback);
    }
  }catch(error){console.warn('[loc-pics] local fallback encoder:',name,error.message);}
  fs.writeFileSync(output,fallback);
  saved+=original.length-fallback.length;
}
// R2 objects must match this deployment's authoritative original. If a
// source changes before it is mirrored, the existing local URL still works.
const manifest=path.join(root,'workers','hero-source-manifest.generated.mjs');
fs.mkdirSync(path.dirname(manifest),{recursive:true});
fs.writeFileSync(manifest,'export const HERO_SOURCE_HASHES=Object.freeze('+
  JSON.stringify(hashes,null,2)+');\n');
if(slim)console.log('[loc-pics] Hero fallback bytes saved: '+saved);
// Fail during build instead of deploying a homepage with broken default images.
const references=fs.readFileSync(path.join(root,'app','site-images.js'),'utf8');
const imagePaths=[...references.matchAll(new RegExp('/pics/([A-Za-z0-9_.-]+)','g'))]
  .map(match=>match[1]);
for(const filename of imagePaths){
  if(!fs.existsSync(path.join(target,filename)))
    throw new Error('LOC homepage image not found: /pics/'+filename);
}
console.log('[loc-pics] '+imagePaths.length+' declared homepage references verified; LOC images staged for '+(native?'iOS':'Web'));
