import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const api=path.join(root,'app','api');
const parked=path.join(root,'.loc-api-static-export-build');
if(!fs.existsSync(api))throw new Error('Expected Next API routes at app/api');
if(fs.existsSync(parked))throw new Error('Found an unfinished static-export build at .loc-api-static-export-build');

const npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,env=process.env){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit',shell:process.platform==='win32'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
}

// Public JS/CSS snapshots are explicitly published and committed beforehand.
// Static exports must never read Supabase simply to build app assets.
run(npm,['run','prebuild']);
fs.renameSync(api,parked);
try{
  run(process.execPath,[path.join(root,'node_modules','next','dist','bin','next'),'build'],{
    ...process.env,
    LOC_STATIC_EXPORT:'1'
  });
  run(process.execPath,[path.join(root,'scripts','copy-static-assets.mjs')]);
  run(process.execPath,[path.join(root,'scripts','diagnose-effekseer-smoke.mjs')]);
}finally{
  fs.renameSync(parked,api);
}
