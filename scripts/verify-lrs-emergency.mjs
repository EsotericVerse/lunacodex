#!/usr/bin/env node
/** Preflight only: do NOT grant, refresh, renew or deploy from this command.
 * One-time signed request is checked again immediately before any future
 * credentialed Cloudflare step; no trusted secret values are printed.
 */
import {verifyLrsEmergencyAuthorization} from './lrs-emergency-authorization.mjs';

try{
 const body=JSON.parse(process.env.LOC_LRS_EMERGENCY_REQUEST||'null');
 const maxTtlSeconds=process.env.LOC_EMERGENCY_MAX_TTL_SECONDS===undefined?
   21600:Number(process.env.LOC_EMERGENCY_MAX_TTL_SECONDS);
 const result=verifyLrsEmergencyAuthorization({
  request:body?.request,signature:body?.signature,
  secret:process.env.CLOUDFLARE_API_TOKEN,now:Date.now(),
  maxTtlSeconds
 });
 console.log(JSON.stringify({action:result.action,reason:result.reason,
   desiredSha:result.desiredSha,expiresAt:result.expiresAt}));
}catch(error){
 console.error('[lrs-emergency] denied: '+error.message);
 process.exitCode=1;
}
