import {createHash} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {EFFECT_ASSET_BLOBS} from './rune-effekseer-asset-manifest.mjs';
import {RETIRED_EFFECT_ASSETS} from './rune-effekseer-retired-assets.mjs';
import {resolvePinnedEffekseerTarget} from './pinned-effekseer-path.mjs';

// Install pinned, professionally-authored Effekseer effects and their complete direct
// texture/material/model dependencies at build time. No custom particles are generated.
const ROOT=resolve('public/vendor/effekseer/Collections');
function valid(bytes,item){
 if(bytes.length!==item.size)return false;
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')===item.sha;
}
async function install(item){
 const target=resolvePinnedEffekseerTarget(ROOT,item.target);
 try{if(valid(await readFile(target),item))return false;}catch(error){if(error.code!=='ENOENT')throw error;}
 const url='https://raw.githubusercontent.com/'+item.repo+'/'+item.revision+'/'+item.path.split('/').map(encodeURIComponent).join('/');
 let error;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw Error('HTTP '+response.status+' '+item.path);
   const bytes=Buffer.from(await response.arrayBuffer());
   if(!valid(bytes,item))throw Error('Pinned Effekseer asset integrity mismatch: '+item.target);
   await mkdir(dirname(target),{recursive:true});
   const temp=target+'.part-'+process.pid;
   try{await writeFile(temp,bytes);await rename(temp,target);}
   finally{await rm(temp,{force:true});}
   return true;
  }catch(e){error=e;if(String(e.message).includes('integrity mismatch'))break;}
 }
 throw Error('Unable to install authored Effekseer '+item.target+': '+String(error?.message||error));
}
async function main(){
 if(new Set(EFFECT_ASSET_BLOBS.map(item=>item.target)).size!==EFFECT_ASSET_BLOBS.length)throw Error('Duplicate effects in asset manifest');
 let cursor=0,installed=0;
 const worker=async()=>{while(cursor<EFFECT_ASSET_BLOBS.length){
  const item=EFFECT_ASSET_BLOBS[cursor++];
  if(await install(item))installed++;
 }};
 await Promise.all(Array.from({length:Math.min(8,EFFECT_ASSET_BLOBS.length)},()=>worker()));
 console.log('Pinned authored Effekseer effects: '+EFFECT_ASSET_BLOBS.length+' files verified, '+installed+' installed.');
}

async function pruneRetired(){
 let removed=0,modified=0;
 const kept=new Set(EFFECT_ASSET_BLOBS.map(item=>item.target));
 for(const item of RETIRED_EFFECT_ASSETS){
  if(kept.has(item.target))throw Error('Pinned effect incorrectly marked retired: '+item.target);
  const target=resolvePinnedEffekseerTarget(ROOT,item.target);
  try{
   const bytes=await readFile(target);
   // Delete only the original pinned download; never delete locally changed art.
   if(!valid(bytes,item)){modified++;continue;}
   await rm(target,{force:true});
   removed++;
   if(item.target.toLowerCase().endsWith('.png')){
    const parts=item.target.split('/'),file=parts.pop();
    const derived=resolvePinnedEffekseerTarget(ROOT,parts.join('/')+'/_hd256/'+file);
    await rm(derived,{force:true});
   }
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 console.log('Retired Effekseer assets: '+removed+' pinned files removed; '+modified+' locally modified files left untouched.');
}
await main();
await pruneRetired();
