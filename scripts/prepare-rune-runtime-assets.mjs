// LOC's existing authored art remains unchanged. This is an execution-order
// coordinator, not a renderer, cache, image converter, or asset host.
// Base files can be verified/obtained independently. Derivatives must wait for
// their exact pinned sources (and the native-alpha fog texture) to be ready.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stageOne=[
  'prepare-effekseer-wasm.mjs',
  'prepare-rune-effekseer-assets.mjs',
  'prepare-rune-fog-hd.mjs',
  'prepare-rune-semantic-icons.mjs'
];
const stageTwo=[
  'prepare-rune-effekseer-hd256.mjs',
  'prepare-rune-effekseer-soft-matte.mjs'
];
if(process.argv.includes('--plan')){
  console.log(JSON.stringify({stageOne,stageTwo},null,2));
  process.exit(0);
}
function run(name){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[resolve(root,'scripts',name)],{
      cwd:root,env:process.env,stdio:'inherit',windowsHide:true
    });
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      if(code===0)resolve();
      else reject(new Error(name+' exited '+(signal||code)));
    });
  });
}
async function phase(names){
  const outcomes=await Promise.allSettled(names.map(run));
  const failed=outcomes.filter(x=>x.status==='rejected');
  if(failed.length)throw new AggregateError(failed.map(x=>x.reason),
    'Rune asset preparation failed: '+failed.length+' task(s)');
}
await phase(stageOne);
await phase(stageTwo);
