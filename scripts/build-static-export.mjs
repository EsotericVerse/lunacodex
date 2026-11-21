import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const api=path.join(root,'app','api');
const parked=path.join(root,'.loc-api-static-export-build');
const output=path.join(root,'out');
const nextBuild=path.join(root,'.next');
const targetFile=path.join(nextBuild,'.loc-static-export-target');
const target=process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'?'native':'web';

if(!fs.existsSync(api))throw new Error('Expected Next API routes at app/api');
if(fs.existsSync(parked))throw new Error('Found an unfinished static-export build at .loc-api-static-export-build');

const npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,env=process.env){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit',shell:process.platform==='win32'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
}

// Keep .next/ reusable for the same output target, but never reuse a native
// intermediate build as a Web build (or vice versa) in a shared checkout.
const previousTarget=fs.existsSync(targetFile)?fs.readFileSync(targetFile,'utf8').trim():'';
if(previousTarget&&previousTarget!==target){
  fs.rmSync(nextBuild,{recursive:true,force:true});
  console.log('[static-export] Switched '+previousTarget+' -> '+target+'; discarded incompatible .next cache.');
}

// out/ is a generated delivery artifact. A failed or interrupted build must
// never leave a previous successful export masquerading as the current output.
fs.rmSync(output,{recursive:true,force:true});
// Public JS/CSS snapshots are explicitly published and committed beforehand.
// Static exports must never read Supabase simply to build app assets.
run(npm,['run','prebuild']);
fs.renameSync(api,parked);
let complete=false;
try{
  run(process.execPath,[path.join(root,'node_modules','next','dist','bin','next'),'build'],{
    ...process.env,
    LOC_STATIC_EXPORT:'1'
  });
  run(process.execPath,[path.join(root,'scripts','copy-static-assets.mjs')]);
  // Experiment branch only: bundle Preact against the LOC editor in isolation.
  run(process.execPath,[path.join(root,'scripts','verify-preact-compat-preview.mjs')]);
  // Visual diagnostics are explicit QA, not part of every production build.
  fs.mkdirSync(nextBuild,{recursive:true});
  fs.writeFileSync(targetFile,target+'\n');
  complete=true;
}finally{
  if(!complete)fs.rmSync(output,{recursive:true,force:true});
  fs.renameSync(parked,api);
}
