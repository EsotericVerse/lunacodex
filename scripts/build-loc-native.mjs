// Clean-slate LOC publisher: Node.js filesystem + authored LOC HTML.
// No JSX, React, Preact, Next, Vite, esbuild or framework compatibility step.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {documentHTML,SCOPES,SECTIONS,href} from '../modules/loc/site/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'out');
const published=path.join(root,'app/modular/published-blocks');
const sourceFiles={
  loc:'loc/index.js',lo3rwang:'lo3rwang/index.js',lrunes:'lrunes/index.js'
};
if(!fs.existsSync(path.join(root,'public/loc-native.css')))
  throw new Error('LOC native CSS is missing');
if(!fs.existsSync(path.join(root,'public/loc-native-client.mjs')))
  throw new Error('LOC native client is missing');
const snapshots=Object.create(null);
for(const [scope,relative] of Object.entries(sourceFiles)){
  const source=path.join(published,relative);
  if(!fs.existsSync(source))throw new Error('LOC published data missing: '+source);
  const imported=await import(pathToFileURL(source).href);
  if(!Array.isArray(imported.default))throw new TypeError('Invalid published LOC blocks');
  snapshots[scope]=imported.default;
  if(!snapshots[scope].some(row=>row.page_name==='index'&&Number(row.block_order)===1))
    throw new Error('Missing LOC homepage Hero: '+scope);
}
const temp=path.join(root,'.loc-native-output');
fs.rmSync(temp,{recursive:true,force:true});
fs.mkdirSync(temp,{recursive:true});
try{
  // Never merge a previous framework bundle back into the native output.
  // Copy only native public resources; never ship legacy UI scripts or SW.
  for(const asset of ['loc-native.css','loc-native-client.mjs','CNAME','_headers','_routes.json']){
    const source=path.join(root,'public',asset);
    if(fs.existsSync(source))fs.copyFileSync(source,path.join(temp,asset));
  }
  for(const directory of ['assets']){
    const source=path.join(root,'public',directory);
    if(fs.existsSync(source))fs.cpSync(source,path.join(temp,directory),{recursive:true});
  }
  // LOC's source images remain authored assets, not imported JS/CSS objects.
  const images=path.join(root,'assets/pics');
  if(fs.existsSync(images)){
    const exclude=path.join(images,'64Card_org');
    fs.cpSync(images,path.join(temp,'pics'),{recursive:true,
      filter:entry=>process.env.LOC_NATIVE_BUNDLE!=='1'||
        (entry!==exclude&&!entry.startsWith(exclude+path.sep))});
  }
  const vendor=path.join(root,'node_modules/maplibre-gl/dist');
  // The LOC core builds even with zero installed packages. An installed
  // provider contributes an on-demand extension, never a framework dependency.
  const mapAvailable=fs.existsSync(path.join(vendor,'maplibre-gl.mjs'));
  if(mapAvailable)for(const name of fs.readdirSync(vendor)){
    if(!name.endsWith('.mjs')&&!name.endsWith('.css'))continue;
    const source=path.join(vendor,name);
    if(!fs.statSync(source).isFile())continue;
    const dest=path.join(temp,'_loc','vendor',name);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(source,dest);
  }
  const nativeCore=path.join(temp,'_loc','core');
  fs.mkdirSync(path.dirname(nativeCore),{recursive:true});
  fs.cpSync(path.join(root,'modules/loc/core'),nativeCore,{recursive:true});
  let total=0;
  for(const scope of Object.keys(SCOPES)){
    for(const section of ['home',...Object.keys(SECTIONS).filter(value=>value!=='article')]){
      const pathname=href(scope,section);
      const html=documentHTML({scope,section,rows:snapshots[scope],
        description:section==='home'?'LOC 自有 HTML Framework':
          SCOPES[scope].label+' · '+(SECTIONS[section]||'')});
      const destination=path.join(temp,pathname.slice(1),'index.html');
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.writeFileSync(destination,html,'utf8');
      total++;
    }
  }
  const workDir=path.join(temp,'work');
  fs.mkdirSync(workDir,{recursive:true});
  fs.writeFileSync(path.join(workDir,'index.html'),
    documentHTML({scope:'loc',section:'article',description:'LOC 公開作品'}));
  total++;
  // The ordinary LOC server exposes only its own generated HTML and assets.
  // A native IPA may reuse this directory without any JSX hydration.
  fs.rmSync(output,{recursive:true,force:true});
  fs.renameSync(temp,output);
  fs.writeFileSync(path.join(output,'_loc/native-report.json'),
    JSON.stringify({framework:'LOC',rendering:'HTML',routes:total,
      clientFrameworks:[],mapProvider:mapAvailable,generatedAt:new Date().toISOString()}));
  console.log('[LOC Native] '+total+' HTML pages; independent of React/Preact/Next');
}catch(error){
  fs.rmSync(temp,{recursive:true,force:true});
  throw error;
}
