import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'loc-lock-migration-'));
const original=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
delete manifest.dependencies.next;
manifest.dependencies.preact='10.29.8';
manifest.devDependencies.esbuild='0.28.2';
try{
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify(original));
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const r=spawnSync(npm,['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','--prefix',dir],{cwd:root,encoding:'utf8',timeout:150000});
  if(r.status!==0)throw Error((r.stderr||r.stdout||String(r.error)).slice(-3000));
  const modified=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'));
  const delta={root:modified.packages[''],added:{},removed:[],changed:{}};
  for(const [p,meta] of Object.entries(modified.packages)){
    if(!(p in original.packages))delta.added[p]=meta;
    else if(JSON.stringify(meta)!==JSON.stringify(original.packages[p]))delta.changed[p]=meta;
  }
  for(const p of Object.keys(original.packages)){
    if(!(p in modified.packages))delta.removed.push(p);
  }
  const encoded=Buffer.from(JSON.stringify(delta)).toString('base64');
  console.log('LOC_LOCK_CHUNKS '+Math.ceil(encoded.length/3000)+' '+encoded.length);
  for(let i=0;i<encoded.length;i+=3000)console.log('LOC_LOCK_CHUNK '+Math.floor(i/3000)+' '+encoded.slice(i,i+3000));
}catch(e){console.error('LOC_LOCK_ERROR '+e.message);process.exitCode=1;}
finally{fs.rmSync(dir,{recursive:true,force:true});}
