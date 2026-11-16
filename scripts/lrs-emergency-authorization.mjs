/**
 * LOC <- LRS emergency request. Never issues a token, grant, refresh, or
 * permission change. Signed request is a TIME-BOUND instruction, not a new
 * Cloudflare permission. Both sides keep their existing secret value.
 *
 * Sender: HMAC-SHA256(key=LOC_EMERGENCY_KEY, data=emergencySigningPayload).
 * Receiver: uses existing GitHub Actions CLOUDFLARE_API_TOKEN as the HMAC
 * verification key. No secret contents are logged or copied to output.
 *
 * TTL is capped at six hours for compatibility with the current policy.
 * LOC_EMERGENCY_MAX_TTL_SECONDS may SHORTEN it, never enlarge it.
 * The TTL bounds the request; actual API token expiry is enforced separately
 * by Cloudflare, and this code MUST NOT attempt to renew that token.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

const SHA=/^[a-f0-9]{40}$/;
const GHSA=/^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/i;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const MAX_EMERGENCY_TTL_SECONDS=6*60*60;
const KEYS=[
  'schema','reason','repo','worker','desiredSha','deployedSha',
  'workerVersionId','advisoryId','issuedAt','expiresAt','nonce'
];

export function emergencySigningPayload(request){
  if(!request||typeof request!=='object'||Array.isArray(request))
    throw Error('Invalid emergency request');
  if(Object.keys(request).length!==KEYS.length||
     KEYS.some(key=>!Object.hasOwn(request,key)))
    throw Error('Emergency request must have exact signed fields; no grant or renewal fields');
  return JSON.stringify(KEYS.map(k=>request[k]));
}

export function verifyLrsEmergencyAuthorization({
  request,signature,secret,now=Date.now(),
  maxTtlSeconds=MAX_EMERGENCY_TTL_SECONDS,
  approvedMajorSha=''
}){
  const content=emergencySigningPayload(request);
  if(typeof secret!=='string'||secret.length<16)
    throw Error('Existing emergency secret unavailable; refuse request');
  if(typeof signature!=='string'||!/^[a-f0-9]{64}$/i.test(signature))
    throw Error('Missing or invalid emergency signature');
  const expected=createHmac('sha256',secret).update(content).digest();
  if(!timingSafeEqual(Buffer.from(signature,'hex'),expected))
    throw Error('Emergency request signature mismatch');
  if(!Number.isSafeInteger(maxTtlSeconds)||maxTtlSeconds<=0||
     maxTtlSeconds>MAX_EMERGENCY_TTL_SECONDS)
    throw Error('Emergency TTL maximum must not exceed current six-hour cap');
  if(request.schema!=='loc.lrs-emergency.v1'||
     request.repo!=='EsotericVerse/lunarunes'||request.worker!=='lunarunes')
    throw Error('Emergency request targets an unapproved repository/worker');
  if(!SHA.test(request.desiredSha||'')||
     !/^[a-f0-9]{32,64}$/.test(request.nonce||''))
    throw Error('Emergency request needs an exact commit and unique nonce');
  if(!UTC.test(request.issuedAt||'')||!UTC.test(request.expiresAt||''))
    throw Error('Emergency request requires UTC timestamps');
  const issued=Date.parse(request.issuedAt),expires=Date.parse(request.expiresAt);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||
     expires<=issued||expires-issued>maxTtlSeconds*1000)
    throw Error('Emergency request exceeds configured TTL');
  if(!Number.isFinite(now)||now<issued||now>=expires)
    throw Error('Emergency request expired or not yet valid');
  if(request.reason==='security'){
    if(!SHA.test(request.deployedSha||'')||
       !UUID.test(request.workerVersionId||'')||
       !GHSA.test(request.advisoryId||'')||
       request.desiredSha===request.deployedSha)
      throw Error('Security emergency requires deployed version, advisory and FIXED revision');
  }else if(request.reason==='major'){
    // Owner explicitly approves the exact SHA in LOC GitHub Actions variables.
    // A signed request alone is never sufficient to authorize a major release.
    if(!SHA.test(request.deployedSha||'')||
       !UUID.test(request.workerVersionId||'')||
       request.advisoryId!==null||
       request.desiredSha===request.deployedSha)
      throw Error('Major release requires existing deployed version and exact target');
    if(!SHA.test(approvedMajorSha)||request.desiredSha!==approvedMajorSha)
      throw Error('Major release lacks owner-approved exact SHA');
  }else if(request.reason==='bootstrap'){
    if(request.deployedSha!==null||
       request.workerVersionId!==null||request.advisoryId!==null)
      throw Error('Bootstrap emergency must establish verified missing baseline');
  }else{
    throw Error('Ordinary release is not a permissible emergency');
  }
  return Object.freeze({
    action:request.reason==='security'?'verify-security-before-deploy':
      request.reason==='major'?'verify-owner-major-release-before-deploy':'verify-baseline-before-deploy',
    reason:request.reason,
    desiredSha:request.desiredSha,
    deployedSha:request.deployedSha,
    workerVersionId:request.workerVersionId,
    advisoryId:request.advisoryId,
    nonce:request.nonce,
    expiresAt:request.expiresAt
  });
}
