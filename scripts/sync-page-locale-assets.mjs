// Copies sibling page.jsx i18n JSON into Next public assets for both Web and
// native IPA exports. Source-of-truth stays beside each page.jsx, not in public.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'app');
const target=path.join(root,'public','i18n');
const locales=['zh_tw','zh_cn','en','ja'];

function pageDirs(folder,found=[]){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const full=path.join(folder,entry.name);
    if(entry.isFile()&&entry.name==='page.jsx')found.push(folder);
    else if(entry.isDirectory())pageDirs(full,found);
  }
  return found;
}
function verifiedCopy(source,destination){
  if(!fs.existsSync(source))throw new Error('Missing page locale JSON: '+path.relative(root,source));
  const parsed=JSON.parse(fs.readFileSync(source,'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    throw new Error('Invalid locale object: '+path.relative(root,source));
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(source,destination);
}
const pages=pageDirs(app);
if(!pages.length)throw new Error('No page.jsx routes found');
// Only these two generated namespaces belong to this script. Do not touch
// other public files or another Agent's assets.
for(const suffix of ['pages','shared'])
  fs.rmSync(path.join(target,suffix),{recursive:true,force:true});
for(const dir of pages){
  const route=path.relative(app,dir).replace(/\\/g,'/')||'index';
  for(const locale of locales)
    verifiedCopy(path.join(dir,'i18n',locale+'.json'),
      path.join(target,'pages',route,locale+'.json'));
}
for(const locale of locales)
  verifiedCopy(path.join(app,'i18n','shared',locale+'.json'),
    path.join(target,'shared',locale+'.json'));
console.log('[page-locales] '+pages.length+' page.jsx routes × 4 = '+pages.length*4+' route JSON files; 4 shared locale assets.');
