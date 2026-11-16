#!/usr/bin/env node
/**
 * LOC controls whether LRS is ever asked to release; this module has no I/O
 * or Cloudflare permissions. Normal merges, version differences and major
 * releases NEVER automatically deploy either repository.
 *
 * Two exceptions:
 *  - a verified absent LRS production baseline can be bootstrapped;
 *  - a verified security incident affecting the deployed LRS can force a
 *    fixed LRS SHA, without waiting for owner approval.
 *
 * The caller MUST independently fetch and authenticate both the Cloudflare
 * baseline evidence and Github dependency advisory/fix evidence. Do not
 * accept arbitrary user-supplied payloads as verified. This planner alone
 * does not authorize a deployment token or perform a release.
 */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const SHA=/^[0-9a-f]{40}$/;
const MEDIA=/^[0-9a-f]{64}$/;
const GHSA=/^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/i;
const SOURCE='EsotericVerse/lunarunes';

function validateMedia(desiredMediaVersion,deployedMediaVersion){
  if(desiredMediaVersion!==undefined&&!MEDIA.test(desiredMediaVersion))
    throw Error('Invalid desired LRS mediaVersion');
  if(deployedMediaVersion!==undefined&&!MEDIA.test(deployedMediaVersion))
    throw Error('Invalid deployed LRS mediaVersion');
  if((desiredMediaVersion===undefined)!==(deployedMediaVersion===undefined))
    throw Error('Both LRS media versions must be verified together');
}

/**
 * Pure decision result; dispatchers must independently validate real remote
 * provenance before acting on any result. No blanket 'force' flag is accepted.
 *
 * baseline evidence is issued ONLY from a successful authenticated lookup
 * of the real LRS Cloudflare Worker deployments. Lack of access is unknown,
 * never 'missing'. An empty deployment list alone is not proof that LRS
 * materials are missing; the caller must verify the service/asset baseline.
 *
 * incident evidence must come from a newly checked open Dependabot/GHSA
 * finding, resolve an affected deployed SHA and a distinct fixed Git SHA.
 * An alert without an available remediated revision cannot deploy old code.
 */
export function planLrsDeployment({
  desiredSha,deployedSha,desiredMediaVersion,deployedMediaVersion,
  baseline=null,incident=null
}){
  if(!SHA.test(desiredSha||''))
    throw Error('LRS desired game commit must be an exact 40-character SHA');
  if(deployedSha===null){
    if(!baseline||baseline.source!=='cloudflare-lrs-production'||
       baseline.verified!==true||baseline.status!=='missing')
      throw Error('Missing LRS production requires independently verified baseline evidence');
    if(incident)throw Error('Security update needs a verified deployed LRS source; bootstrap separately');
    // Never infer media versions for a baseline that has not been deployed.
    if(deployedMediaVersion!==undefined)throw Error('Missing LRS baseline cannot report deployed media');
    if(desiredMediaVersion!==undefined&&!MEDIA.test(desiredMediaVersion))
      throw Error('Invalid desired LRS mediaVersion');
    return Object.freeze({
      schema:'loc.lrs-release-plan.v2',source:SOURCE,
      action:'bootstrap-required',desiredSha,reason:'verified-missing-baseline',
      assetsChanged:desiredMediaVersion!==undefined
    });
  }
  if(!SHA.test(deployedSha||''))
    throw Error('LRS deployed game commit is unverified; refuse automatic release');
  validateMedia(desiredMediaVersion,deployedMediaVersion);
  const changed=desiredSha!==deployedSha;
  const assetsChanged=desiredMediaVersion!==undefined&&
    desiredMediaVersion!==deployedMediaVersion;
  if(!changed&&assetsChanged)
    throw Error('Inconsistent LRS mediaVersion for the matching deployed game SHA');
  if(incident!==null){
    if(incident.source!=='github-dependabot-api'||incident.verified!==true||
       incident.state!=='open'||!GHSA.test(incident.advisoryId||'')||
       incident.affectedSha!==deployedSha||incident.fixedSha!==desiredSha||
       incident.fixVerified!==true)
      throw Error('Unverified or unrelated LRS security advisory: no emergency deployment');
    if(!changed)
      throw Error('Security advisory requires a verified FIXED LRS revision, not redeploying vulnerable code');
    return Object.freeze({
      schema:'loc.lrs-release-plan.v2',source:SOURCE,
      action:'force-security-release',desiredSha,deployedSha,
      assetsChanged,advisoryId:incident.advisoryId,
      reason:'verified-affected-dependency'
    });
  }
  return Object.freeze({
    schema:'loc.lrs-release-plan.v2',source:SOURCE,
    action:changed?'manual-review':'skip',
    desiredSha,deployedSha,assetsChanged,
    ...(desiredMediaVersion===undefined?{}:{desiredMediaVersion,deployedMediaVersion}),
    reason:changed?'ordinary-version-delta':'identical-deployment'
  });
}

/** Normal LRS releases, including major ones, do NOT redeploy LOC.
 * The only automatic actions are LRS bootstrap/security handling above.
 * LOC itself still auto-deploys on its OWN main merges; that is unrelated.
 */
export function planLocForLrsRelease({
  sourceRepo,releaseKind,releaseTag,releaseSha,published,verified,
  lastIntegratedSha
}){
  if(sourceRepo!==SOURCE)
    throw Error('LOC can only accept an LRS release from EsotericVerse/lunarunes');
  // For informational use only: never turn a normal LRS release or tag
  // into a LOC deploy hook, including a major version tag.
  return Object.freeze({
    schema:'loc.lrs-major-integration.v2',
    action:'skip',
    reason:'lrs-release-does-not-auto-deploy-loc'
  });
}
function parse(args){
  if(args.length!==2)
    throw Error('Usage: node scripts/plan-lrs-deployment.mjs <verified-desired-and-deployed-versions.json> <output.json>');
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
