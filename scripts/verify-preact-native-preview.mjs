// Native-only preflight on the LOC migration preview branch; no production extra build.
import {spawnSync} from 'node:child_process';
if(process.env.CF_PAGES_BRANCH!=='migration/loc-preact-esbuild-20261121'){
  console.log('[LOC IPA preflight] skipped outside isolated migration preview');
  process.exit(0);
}
const env={...process.env,LOC_NATIVE_BUNDLE:'1'};
for(const file of ['scripts/build-preact-static.mjs','scripts/verify-preact-output.mjs']){
  const result=spawnSync(process.execPath,[file],{env,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('IPA preflight failed in '+file+' ('+result.status+')');
}
console.log('[LOC IPA preflight] native static bundle PASS; building Web delivery next');
