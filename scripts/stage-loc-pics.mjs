// Publish only LOC-owned images at /pics/ for Next dev, standard Next builds
// and static exports. The authoritative files remain at assets/pics/.
// This is a build-time copy, not a browser cache or an image import into JS.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'assets','pics');
const target=path.join(root,'public','pics');
const native=process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1';
const excluded=native?path.join(source,'64Card_org'):null;
if(!fs.existsSync(source))throw new Error('LOC images missing: '+source);
fs.rmSync(target,{recursive:true,force:true});
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.cpSync(source,target,{recursive:true,filter:entry=>
  !excluded||(entry!==excluded&&!entry.startsWith(excluded+path.sep))});
// Fail during build instead of deploying a homepage with broken default images.
const references=fs.readFileSync(path.join(root,'app','site-images.js'),'utf8');
const imagePaths=[...references.matchAll(new RegExp('/pics/([A-Za-z0-9_.-]+)','g'))]
  .map(match=>match[1]);
for(const filename of imagePaths){
  if(!fs.existsSync(path.join(target,filename)))
    throw new Error('LOC homepage image not found: /pics/'+filename);
}
console.log('[loc-pics] '+imagePaths.length+' declared homepage references verified; LOC images staged for '+(native?'iOS':'Web'));
