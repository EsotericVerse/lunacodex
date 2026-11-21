// Audits generated public output only; never removes files or changes routes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve('out');
if(!fs.existsSync(root))throw Error('Static output directory out/ missing');
const records=[],allFiles=[],groups=new Map(),fragments=new Map();
function walk(folder){
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    const abs=path.join(folder,item.name);
    if(item.isDirectory()){walk(abs);continue;}
    if(!item.isFile())continue;
    const rel='/'+path.relative(root,abs).replaceAll(path.sep,'/');
    const ext=path.extname(rel).toLowerCase();
    const bytes=fs.statSync(abs).size;
    allFiles.push({rel,ext:ext||'(none)',bytes});
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

// Whole-export inventory includes pics, fonts, WASM and other binary assets.
// Only identical-size candidates are hashed, using a fixed buffer to avoid
// loading large images into memory. Repeated payloads are diagnostic, not
// permission to delete valid HTML/Flight resources or public URLs.
const bySize=new Map();
for(const record of allFiles){
  if(!bySize.has(record.bytes))bySize.set(record.bytes,[]);
  bySize.get(record.bytes).push(record);
}
const knownHashes=new Map(records.map(record=>[record.rel,record.digest]));
function fileHash(relative){
  const cached=knownHashes.get(relative);
  if(cached)return cached;
  const file=path.join(root,relative.slice(1));
  const handle=fs.openSync(file,'r');
  const chunk=Buffer.allocUnsafe(256*1024);
  const hash=crypto.createHash('sha256');
  try{
    for(;;){
      const bytes=fs.readSync(handle,chunk,0,chunk.length,null);
      if(!bytes)break;
      hash.update(chunk.subarray(0,bytes));
    }
  }finally{fs.closeSync(handle);}
  return hash.digest('hex');
}
const identical=[];
for(const candidates of bySize.values()){
  if(candidates.length<2)continue;
  const byHash=new Map();
  for(const entry of candidates){
    const digest=fileHash(entry.rel);
    if(!byHash.has(digest))byHash.set(digest,[]);
    byHash.get(digest).push(entry);
  }
  for(const matches of byHash.values())if(matches.length>1)identical.push(matches);
}
identical.sort((a,b)=>b[0].bytes*(b.length-1)-a[0].bytes*(a.length-1));
function groupedSummary(keyOf){
  const groups=new Map();
  for(const file of allFiles){
    const key=keyOf(file);
    const item=groups.get(key)||{files:0,bytes:0};
    item.files++;item.bytes+=file.bytes;groups.set(key,item);
  }
  return Object.fromEntries([...groups.entries()]
    .sort((a,b)=>b[1].bytes-a[1].bytes));
}
console.log('[output-size-audit] '+JSON.stringify({
  files:allFiles.length,
  bytes:allFiles.reduce((sum,file)=>sum+file.bytes,0),
  byExtension:groupedSummary(file=>file.ext),
  byTopLevel:groupedSummary(file=>{
    const segments=file.rel.slice(1).split('/');
    return segments.length>1?'/'+segments[0]+'/':'(root)';
  }),
  largest:allFiles.slice().sort((a,b)=>b.bytes-a.bytes).slice(0,20),
  identicalGroups:identical.length,
  identicalPayloadBytes:identical.reduce((sum,group)=>sum+group[0].bytes*(group.length-1),0),
  largestIdenticalGroups:identical.slice(0,15).map(group=>({
    bytesEach:group[0].bytes,count:group.length,
    paths:group.slice(0,5).map(item=>item.rel)
  }))
},null,2));

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
  candidates:unmatched
}));

const sharedZh=JSON.parse(fs.readFileSync(path.resolve('app/i18n/shared/zh_tw.json'),'utf8'));
const unusedUiExtra=[];
const checkedUiExtra=[];
function inspectCopy(node,prefix){
  if(!node||typeof node!=='object'||Array.isArray(node))return;
  for(const [key,value] of Object.entries(node)){
    const trail=[...prefix,key];
    if(value&&typeof value==='object'&&!Array.isArray(value)){inspectCopy(value,trail);continue;}
    const referenced=sourceFiles.some(file=>file.text.includes(key));
    checkedUiExtra.push(trail.join('.'));
    if(!referenced)unusedUiExtra.push(trail.join('.'));
  }
}
inspectCopy(sharedZh.uiExtra,['uiExtra']);
console.log('[locale-extra-audit] '+JSON.stringify({
  total:checkedUiExtra.length,unreferenced:unusedUiExtra.length,keys:unusedUiExtra
}));
