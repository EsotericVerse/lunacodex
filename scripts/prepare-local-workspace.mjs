// npm lifecycle 'prepare' is for the developer's local Git/Agent workspace.
// A disposable Cloudflare/GitHub build never pushes Git or runs Claude Skills;
// leave these local mutations out of dependency installation there.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

if(process.env.CI==='true'||process.env.CF_PAGES==='1'||process.env.GITHUB_ACTIONS==='true'){
  console.log('prepare: CI build; local Git hooks/Agent skills are not installed.');
  process.exit(0);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const name of ['setup-git-hooks.mjs','sync-claude-skills.mjs']){
  const run=spawnSync(process.execPath,[resolve(root,'scripts',name)],{
    cwd:root,env:process.env,stdio:'inherit',windowsHide:true
  });
  if(run.error)throw run.error;
  if(run.status!==0)throw new Error(name+' failed ('+(run.signal||run.status)+')');
}
