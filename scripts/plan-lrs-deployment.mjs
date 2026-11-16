#!/usr/bin/env node
/**
 * LOC -> LRS release planning, deliberately side-effect free.
 *
 * The deployed Worker version ID and rune-release.json sourceCommit are not
 * interchangeable with the LRS application commit SHA. The caller must
 * supply a VERIFIED deployed game SHA and the chosen exact source SHA.
 * Unknown/ambiguous values must never trigger a cross-repo deployment.
 */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const SHA=/^[0-9a-f]{40}$/;
const MEDIA=/^[0-9a-f]{64}$/;
export function planLrsDeployment({desiredSha,deployedSha,desiredMediaVersion,deployedMediaVersion}){
 if(!SHA.test(desiredSha||''))throw new Error('LRS desired game commit must be an exact 40-character SHA');
 if(!SHA.test(deployedSha||''))throw new Error('LRS deployed game commit is unverified; refuse automatic release');
 if(desiredMediaVersion!==undefined&&!MEDIA.test(desiredMediaVersion))
   throw new Error('Invalid desired LRS mediaVersion');
 if(deployedMediaVersion!==undefined&&!MEDIA.test(deployedMediaVersion))
   throw new Error('Invalid deployed LRS mediaVersion');
 if((desiredMediaVersion===undefined)!==(deployedMediaVersion===undefined))
   throw new Error('Both LRS media versions must be verified together');
 const changed=desiredSha!==deployedSha;
 const assetsChanged=desiredMediaVersion!==undefined&&desiredMediaVersion!==deployedMediaVersion;
 // A mismatched media version for the same source SHA is an inconsistent
 // reported deployment, not permission to silently publish unknown content.
 if(!changed&&assetsChanged)throw Error('Inconsistent LRS deployed mediaVersion for matching game SHA');
 return Object.freeze({
   schema:'loc.lrs-release-plan.v1',
   action:changed?'release':'skip',
   source:'EsotericVerse/lunarunes',
   desiredSha,deployedSha,assetsChanged,
   ...(desiredMediaVersion===undefined?{}:{desiredMediaVersion,deployedMediaVersion})
 });
}
/**
 * LRS -> LOC is a separate direction from LOC -> LRS.
 *
 * Normal LRS merges, previews, hotfixes and minor media releases never
 * schedule a LOC deployment. Only a confirmed, PUBLISHED major LRS release
 * can ask LOC to rebuild its integrated Web application. This planner never
 * dispatches any Cloudflare operation or obtains/retains credentials.
 */
export function planLocForLrsRelease({
  sourceRepo,releaseKind,releaseTag,releaseSha,published,verified,
  lastIntegratedSha
}){
  if(sourceRepo!=='EsotericVerse/lunarunes')
    throw Error('LOC can only accept an LRS release from EsotericVerse/lunarunes');
  if(releaseKind!=='major')
    return Object.freeze({schema:'loc.lrs-major-integration.v1',action:'skip',reason:'not-major'});
  if(published!==true||verified!==true)
    throw Error('LRS major must be published and independently verified before LOC joins');
  if(!/^v[1-9]\d*\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseTag||''))
    throw Error('LRS major release requires a validated immutable version tag');
  if(!SHA.test(releaseSha||''))
    throw Error('LRS major release must resolve to an exact verified Git commit');
  if(lastIntegratedSha!==null&&!SHA.test(lastIntegratedSha||''))
    throw Error('LOC last integrated LRS commit must be verified, or explicitly null for first integration');
  return Object.freeze({
    schema:'loc.lrs-major-integration.v1',
    action:releaseSha===lastIntegratedSha?'skip':'request-loc-deployment',
    releaseTag,releaseSha,
    reason:releaseSha===lastIntegratedSha?'already-integrated':'published-major'
  });
}
function parse(args){
 if(args.length!==2)throw Error('Usage: node scripts/plan-lrs-deployment.mjs <verified-desired-and-deployed-versions.json> <output.json>');
 return args;
}
async function main(){
 const fs=await import('node:fs/promises');
 const [source,output]=parse(process.argv.slice(2));
 const input=JSON.parse(await fs.readFile(resolve(source),'utf8'));
 const plan=planLrsDeployment(input);
 await fs.writeFile(resolve(output),JSON.stringify(plan,null,2)+'\n',{flag:'w'});
 console.log(JSON.stringify({action:plan.action,assetsChanged:plan.assetsChanged,desiredSha:plan.desiredSha}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{console.error('[loc:lrs] '+error.message);process.exitCode=1;});
