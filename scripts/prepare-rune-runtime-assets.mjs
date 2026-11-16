// LOC's existing authored art remains unchanged. This is an execution-order
// coordinator, not a renderer, cache, image converter, or asset host.
// Base files can be verified/obtained independently. Derivatives must wait for
// their exact pinned sources (and the native-alpha fog texture) to be ready.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve as resolvePath} from 'node:path';

const root=resolvePath(dirname(fileURLToPath(import.meta.url)),'..');
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
// Keep path resolution independent of the Promise completion callback;
// otherwise Node receives "undefined" as its script name and assets disappear.
function runProcess(args,label){
  return new Promise((done,fail)=>{
    const child=spawn(process.execPath,args,{
      cwd:root,env:process.env,stdio:'inherit',windowsHide:true
    });
    child.once('error',fail);
    child.once('close',(code,signal)=>{
      if(code===0)done();
      else fail(new Error(label+' exited '+(signal||code)));
    });
  });
}
function run(name){
  if(!/^[a-z0-9-]+\.mjs$/.test(name))throw Error('Invalid job name: '+name);
  return runProcess([resolvePath(root,'scripts',name)],name);
}
if(process.argv.includes('--self-test')){
  // Exercise a real child-process success and failure without fetching assets.
  await runProcess(['--eval','process.exit(0)'],'success-probe');
  let failureWasDetected=false;
  try{await runProcess(['--eval','process.exit(23)'],'failure-probe');}
  catch{failureWasDetected=true;}
  if(!failureWasDetected)throw Error('Child process failure was incorrectly ignored');
  console.log('Asset runner self-test: child-process success/failure PASS');
  process.exit(0);
}
async function phase(names){
  const outcomes=await Promise.allSettled(names.map(run));
  const failed=outcomes.filter(x=>x.status==='rejected');
  if(failed.length)throw new AggregateError(failed.map(x=>x.reason),
    'Rune asset preparation failed: '+failed.length+' task(s)');
}
await phase(stageOne);
await phase(stageTwo);
