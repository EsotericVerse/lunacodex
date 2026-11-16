#!/usr/bin/env node
/** Preflight only: do NOT grant, refresh, renew or deploy from this command.
 * One-time signed request is checked again immediately before any future
 * credentialed Cloudflare step; no trusted secret values are printed.
 */
import {verifyLrsEmergencyAuthorization} from './lrs-emergency-authorization.mjs';
import {appendFileSync} from 'node:fs';

try{
 const body=JSON.parse(process.env.LOC_LRS_EMERGENCY_REQUEST||'null');
 const maxTtlSeconds=!process.env.LOC_EMERGENCY_MAX_TTL_SECONDS?
   21600:Number(process.env.LOC_EMERGENCY_MAX_TTL_SECONDS);
 const result=verifyLrsEmergencyAuthorization({
  request:body?.request,signature:body?.signature,
  secret:process.env.CLOUDFLARE_API_TOKEN,now:Date.now(),
  maxTtlSeconds,
  approvedMajorSha:process.env.LRS_MAJOR_RELEASE_APPROVED_SHA||''
 });
 if(process.env.GITHUB_OUTPUT){
  appendFileSync(process.env.GITHUB_OUTPUT,
    'target_sha='+result.desiredSha+'\n'+
    'reason='+result.reason+'\n'+
    'expected_version='+(result.workerVersionId||'')+'\n'+
    'advisory='+(result.advisoryId||'')+'\n');
 }
 console.log(JSON.stringify({action:result.action,reason:result.reason,
   desiredSha:result.desiredSha,expiresAt:result.expiresAt}));
}catch(error){
 console.error('[lrs-emergency] denied: '+error.message);
 process.exitCode=1;
}
