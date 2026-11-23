// pnpm lifecycle 'prepare' generates the runtime adapters for fresh clones.
// CI also needs them before tests that import the public UI or ZenStack schema.
// Local Git hooks and Agent skill links are intentionally skipped in CI.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function runScript(name){
  const run=spawnSync(process.execPath,[resolve(root,'scripts',name)],{
    cwd:root,env:process.env,stdio:'inherit',windowsHide:true
  });
  if(run.error)throw run.error;
  if(run.status!==0)throw new Error(name+' failed ('+(run.signal||run.status)+')');
}
// Files generated here are ignored by Git, and no database connection is used.
for(const name of ['sync-page-locale-assets.mjs','sync-zenstack-schema-contract.mjs'])
  runScript(name);

if(process.env.CI==='true'||process.env.CF_PAGES==='1'||process.env.GITHUB_ACTIONS==='true'){
  console.log('prepare: CI build; local Git hooks/Agent skills are not installed.');
  process.exit(0);
}
for(const name of ['setup-git-hooks.mjs','sync-claude-skills.mjs'])
  runScript(name);
