import {existsSync,statSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// Static export must contain the principal Guest and management mounts.
// This checks file generation only; browser behavior and RLS need separate tests.
const routes=[
  '', 'search', 'culture', 'culture/manage', 'statics', 'statics/manage',
  'trace', 'lo3rwang/trace', 'lrunes/trace', 'scope-shell/trace',
  'lo3rwang', 'lo3rwang/search', 'lo3rwang/culture', 'lo3rwang/statics',
  'lrunes', 'lrunes/search', 'lrunes/game', 'game/room',
  'scope-shell', 'scope-shell/search',
  'admin', 'search/manage', 'lrunes/manage', 'lrunes/manage/search',
  'lrunes/culture/manage', 'lrunes/statics/manage', 'lrunes/trace/manage', 'lrunes/search/manage',
  'lo3rwang/manage', 'lo3rwang/manage/search',
  'lo3rwang/culture/manage', 'lo3rwang/statics/manage', 'lo3rwang/trace/manage', 'lo3rwang/search/manage',
  'scope-shell/manage', 'scope-shell/manage/search',
  'scope-shell/culture/manage', 'scope-shell/statics/manage', 'scope-shell/trace/manage', 'scope-shell/search/manage',
  'local/settings', 'local/manage'
];
const root=process.argv[2]||'out';
const missing=routes.filter(route=>{
  const path=join(root,route,'index.html');
  return !existsSync(path)||!statSync(path).isFile()||statSync(path).size===0;
});
// Retain only /sw.js as a retirement tombstone for existing registrations.
// The PWA manifest has been deliberately removed.
const pwaAssets=['sw.js'];
const missingAssets=pwaAssets.filter(file=>{
  const target=join(root,file);
  return !existsSync(target)||!statSync(target).isFile()||statSync(target).size===0;
});
// A previous GitHub Pages bundle embedded the retired isr.lo3rwang.cc
// Worker URL. With ISR disabled, Culture and Statistics could not load.
// Source-code checks are insufficient: inspect the actual publishable files.
const forbiddenIsrFiles=[];
function inspectStaticOutput(dir){
  if(!existsSync(dir))return;
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const file=join(dir,entry.name);
    if(entry.isDirectory())inspectStaticOutput(file);
    else if(entry.isFile()&&/\.(?:js|html)$/i.test(entry.name)){
      const content=readFileSync(file,'utf8').replace(/\\u002e|%2e/gi,'.');
      if(content.includes('isr.lo3rwang.cc'))forbiddenIsrFiles.push(file);
    }
  }
}
inspectStaticOutput(root);
if(missing.length||missingAssets.length||forbiddenIsrFiles.length){
  if(missing.length)console.error('Missing or empty static exports:',missing.map(route=>'/'+route+'/').join(', '));
  if(missingAssets.length)console.error('Missing or empty PWA assets:',missingAssets.join(', '));
  if(forbiddenIsrFiles.length)console.error('Retired ISR endpoint embedded in publishable files:',forbiddenIsrFiles.join(', '));
  process.exitCode=1;
}else console.log('Verified '+routes.length+' Guest and Admin static route exports, '+pwaAssets.length+' PWA assets, and no retired ISR endpoint in JS/HTML.');
