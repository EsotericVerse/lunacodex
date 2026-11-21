// Verify the Preact static export instead of deleting and recopying its public assets.
// public/ is the published Web/native source; assets/ remains the authored master.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'out');
const native=process.env.LOC_NATIVE_BUNDLE==='1';

function requiredFile(base,relative){
  const file=path.join(base,relative);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())
    throw new Error('Static export missing: '+path.relative(root,file));
  const bytes=fs.statSync(file).size;
  if(!bytes)throw new Error('Static export has empty file: '+path.relative(root,file));
  return bytes;
}
function relativeFiles(directory){
  if(!fs.existsSync(directory))throw new Error('Static asset directory missing: '+path.relative(root,directory));
  const found=[];
  function walk(folder,prefix=''){
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      const relative=path.join(prefix,entry.name);
      if(entry.isDirectory())walk(path.join(folder,entry.name),relative);
      else if(entry.isFile())found.push(relative);
    }
  }
  walk(directory);
  return found.sort();
}

requiredFile(output,'index.html');
// Both assets are already part of tracked public/. Do not delete out/assets
// or mirror the entire authored assets/site tree into the deployed site.
for(const relative of [
  'assets/site/icons/loc-favicon.png',
  'assets/site/local/lunarcus-rainbow-hero.avif'
]){
  const sourceBytes=requiredFile(path.join(root,'public'),relative);
  const outputBytes=requiredFile(output,relative);
  if(sourceBytes!==outputBytes)throw new Error('Published asset size differs from public/: '+relative);
}

// prebuild stages LOC-owned /pics/ in public/pics. Preact copies those once.
// A fallback copy here would conceal a broken export or revive old images.
const published='pics';
const sourceDir=path.join(root,'public',published);
const outputDir=path.join(output,published);
const expected=relativeFiles(sourceDir);
const actual=relativeFiles(outputDir);
if(!expected.length)throw new Error('LOC /pics/ publication is empty');
if(expected.length!==actual.length||expected.some((name,i)=>name!==actual[i]))
  throw new Error('LOC /pics/ differs from staged public/pics; rebuild rather than copying a second set');
let bytes=0;
for(const relative of expected){
  const sourceBytes=requiredFile(sourceDir,relative);
  const exportedBytes=requiredFile(outputDir,relative);
  if(sourceBytes!==exportedBytes)throw new Error('LOC /pics/ asset size mismatch: '+relative);
  bytes+=exportedBytes;
}
if(native&&fs.existsSync(path.join(outputDir,'64Card_org')))
  throw new Error('Native export must not include raw card originals');
if(fs.existsSync(path.join(output,'assets','pics')))
  throw new Error('Authored /assets/pics/ was mirrored; only /pics/ is published');

console.log('[static-assets] LOC '+(native?'native':'Web')+' export verified: '+
  expected.length+' /pics/ files ('+bytes+' bytes); 2 public site assets; no second asset copy.');
