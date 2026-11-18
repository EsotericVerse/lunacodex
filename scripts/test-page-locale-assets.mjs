// Route/locale parity, offline asset parity and exact network selection.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'app');
const publicDir=path.join(root,'public');
const langs=['zh_tw','zh_cn','en','ja'];
function visit(dir,out=[]){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,item.name);
    if(item.isDirectory())visit(full,out);
    else if(item.name==='page.jsx')out.push(dir);
  }
  return out;
}
const pages=visit(app);
assert(pages.length>0,'At least one page.jsx required');
const sharedCopies=Object.fromEntries(langs.map(lang=>[
  lang,JSON.parse(fs.readFileSync(path.join(app,'i18n','shared',lang+'.json'),'utf8'))
]));
function allLeafKeys(value,prefix='',keys=[]){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const [field,child] of Object.entries(value))
      allLeafKeys(child,prefix?prefix+'.'+field:field,keys);
  }else keys.push(prefix);
  return keys;
}
function combinedLeafKeys(lang,page){
  const common=sharedCopies[lang];
  const combined={...common,...page,
    uiExtra:{...(common.uiExtra||{}),...(page.uiExtra||{})}};
  return allLeafKeys(combined).sort();
}
for(const dir of pages){
  const route=path.relative(app,dir).replace(/\\/g,'/')||'index';
  let referenceKeys=null;
  for(const lang of langs){
    const pageRoute=path.relative(app,dir).replace(/\\/g,'/');
    const canonical=pageRoute==='lrunes'?'':pageRoute.startsWith('lrunes/')?pageRoute.slice(7):null;
    const source=path.join(canonical===null?dir:path.join(app,canonical),'i18n',lang+'.json');
    const target=path.join(publicDir,'i18n','pages',route,lang+'.json');
    assert(fs.existsSync(source),'Missing '+source);
    assert(fs.existsSync(target),'Not emitted: '+target);
    const data=JSON.parse(fs.readFileSync(source,'utf8'));
    assert(data&&typeof data==='object'&&!Array.isArray(data),'Object required: '+source);
    const keys=combinedLeafKeys(lang,data);
    if(referenceKeys===null)referenceKeys=keys;
    else assert.deepEqual(keys,referenceKeys,
      'Missing or extra translated UI keys in '+route+' ('+lang+')');
    assert.equal(fs.readFileSync(target,'utf8'),fs.readFileSync(source,'utf8'),
      'Public asset must equal colocated page JSON');
  }
}
for(const lang of langs){
  const source=path.join(app,'i18n','shared',lang+'.json');
  assert.equal(fs.readFileSync(path.join(publicDir,'i18n','shared',lang+'.json'),'utf8'),
    fs.readFileSync(source,'utf8'));
}
// Static exports (both Web fallback and native IPA) must actually carry
// the emitted JSON files, not just claim that source/public assets exist.
const outputArg=process.argv.find(arg=>arg.startsWith('--output='));
if(outputArg){
  const exported=path.resolve(root,outputArg.slice('--output='.length));
  for(const dir of pages){
    const route=path.relative(app,dir).replace(/\\/g,'/')||'index';
    for(const lang of langs){
      const relative=path.join('i18n','pages',route,lang+'.json');
      assert.equal(
        fs.readFileSync(path.join(exported,relative),'utf8'),
        fs.readFileSync(path.join(publicDir,relative),'utf8'),
        'Static export missing/mismatched locale: '+relative
      );
    }
  }
  for(const lang of langs){
    const relative=path.join('i18n','shared',lang+'.json');
    assert.equal(
      fs.readFileSync(path.join(exported,relative),'utf8'),
      fs.readFileSync(path.join(publicDir,relative),'utf8'),
      'Static export missing/mismatched shared locale: '+relative
    );
  }
}
// Check actual loader behavior without a live website: no other language or
// route requested; revisiting loaded pages and shared strings hits memory.
const requests=[];
const previousFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  requests.push(url);
  const file=path.join(publicDir,...String(url).split('/').filter(Boolean));
  if(!fs.existsSync(file))return {ok:false,status:404};
  return {ok:true,status:200,json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};
};
try{
  const {loadUiLocale,isUiLocaleLoaded,uiCopy}=await import('../app/i18n/ui-copy.js');
  assert.equal(isUiLocaleLoaded('ja','/culture/'),false);
  await loadUiLocale('ja','/culture/');
  assert.deepEqual(requests,['/i18n/shared/ja.json','/i18n/pages/culture/ja.json']);
  assert.equal(typeof uiCopy('ja','/culture/').culture.river,'string');
  await loadUiLocale('ja','/statics/');
  assert.equal(requests.length,3,'Switching route only loads its page JSON');
  await loadUiLocale('ja','/culture/index.html');
  assert.equal(requests.length,3,'Revisiting loaded route must not re-fetch');
  await loadUiLocale('en','/culture/');
  assert.deepEqual(requests.slice(3),['/i18n/shared/en.json','/i18n/pages/culture/en.json']);
  assert(requests.every(url=>!url.includes('zh_tw')&&!url.includes('zh_cn')));
}finally{
  globalThis.fetch=previousFetch;
}
console.log('[page-locales] verified '+pages.length*langs.length+' page JSON files, 4 shared assets and locale-specific fetching.');
