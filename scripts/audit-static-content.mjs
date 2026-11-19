// Audits generated public output only; never removes files or changes routes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve('out');
if(!fs.existsSync(root))throw Error('Static output directory out/ missing');
const records=[],groups=new Map(),fragments=new Map();
function walk(folder){
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    const abs=path.join(folder,item.name);
    if(item.isDirectory()){walk(abs);continue;}
    if(!item.isFile())continue;
    const rel='/'+path.relative(root,abs).replaceAll(path.sep,'/');
    const ext=path.extname(rel).toLowerCase();
    const bytes=fs.statSync(abs).size;
    if(!['.html','.txt','.json','.js','.css'].includes(ext))continue;
    const data=fs.readFileSync(abs);
    const text=data.toString('utf8');
    const digest=crypto.createHash('sha256').update(data).digest('hex');
    records.push({rel,ext,bytes,digest});
    if(!groups.has(digest))groups.set(digest,[]);
    groups.get(digest).push(rel);
    if(ext!=='.html'&&ext!=='.txt')continue;
    // Text and Flight may both contain legacy page strings. Keep sample paths,
    // but do not echo long articles, private data, or entire serialized states.
    const pieces=text.match(/[\p{Script=Han}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？、：；「」『』（）\s]{13,110}/gu)||[];
    for(const raw of pieces){
      const s=raw.replace(/\s+/g,' ').trim();
      if(s.length<18||s.length>110)continue;
      if(!fragments.has(s))fragments.set(s,{count:0,paths:new Set()});
      const v=fragments.get(s);v.count++;v.paths.add(rel);
    }
  }
}
walk(root);
const same=[...groups.values()].filter(a=>a.length>1)
  .sort((a,b)=>b.length-a.length);
const emptyJson=records.filter(r=>r.ext==='.json'&&r.bytes<=6);
const largest=records.filter(r=>r.ext==='.html'||r.ext==='.js'||r.ext==='.txt')
  .sort((a,b)=>b.bytes-a.bytes).slice(0,12);
const repeated=[...fragments.entries()].map(([fragment,v])=>({fragment,count:v.count,files:v.paths.size,examples:[...v.paths].slice(0,3)}))
  .filter(v=>v.files>=2||v.count>=4)
  .sort((a,b)=>b.files-a.files||b.count-a.count).slice(0,20);
const byType=Object.fromEntries(['.html','.txt','.json','.js','.css'].map(ext=>{
  const items=records.filter(x=>x.ext===ext);
  return [ext,{files:items.length,bytes:items.reduce((n,r)=>n+r.bytes,0)}];
}));
console.log('[content-audit] '+JSON.stringify({total:records.length,byType,emptyJson:emptyJson.map(x=>x.rel).slice(0,30),
  duplicateGroups:same.length,topDuplicateGroups:same.slice(0,12).map(g=>({count:g.length,examples:g.slice(0,4)})),
  largest:largest.map(x=>({path:x.rel,bytes:x.bytes})),repeatedText:repeated},null,2));

// Translation keys are interface copy, not an archive of development notes.
// This is deliberately diagnostic: runtime database-driven labels may not be
// statically visible and must not be deleted just because they aren't literals.
const shared=JSON.parse(fs.readFileSync(path.resolve('app/i18n/shared/en.json'),'utf8'));
const sourceFiles=[];
for(const folder of ['app','packages']){
  const base=path.resolve(folder);
  if(!fs.existsSync(base))continue;
  const scan=dir=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){
        if(['node_modules','.next','published-blocks','i18n'].includes(entry.name))continue;
        scan(full);
      }else if(entry.isFile()&&/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)){
        sourceFiles.push({path:path.relative('.',full).replaceAll(path.sep,'/'),text:fs.readFileSync(full,'utf8')});
      }
    }
  };
  scan(base);
}
const unmatched=[];
for(const label of Object.keys(shared.fields||{})){
  const refs=sourceFiles.filter(file=>file.text.includes(label)).map(file=>file.path);
  if(refs.length===0)unmatched.push(label);
}
console.log('[locale-field-audit] '+JSON.stringify({
  total:Object.keys(shared.fields||{}).length,
  sourceFiles:sourceFiles.length,
  notFoundInSource:unmatched.length,
  // A static code scan does not prove these are safe to delete.
  candidates:unmatched.slice(0,85)
}));
