// LOC deployment acceptance gate. No public HTTP endpoint, no SQL and no auto-grant.
// The Cloudflare-held LOC_WORKFLOW_KEY signs a short-lived published-LAS contract.
const KEYS=['schema','repo','target','sha','worker','version','issuedAt','expiresAt'];
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LAS_REPO='EsotericVerse/lunarcus';
export const LOC_REPO='EsotericVerse/lunacodex';
export const EVENT='loc-las-published';
export const STATE_BRANCH='las-deployment-receipts';
export function verifyLasNotification(payload,sender,now=Date.now()){
  const request=payload?.request;
  if(!request||typeof request!=='object'||Array.isArray(request))
    throw Error('LAS notification request missing');
  // GitHub authenticated the repository_dispatch credential before starting
  // this workflow. Only its pinned owner may request LOC deployment.
  if(sender?.id!==213846782||sender?.login!=='EsotericVerse')
    throw Error('Unauthorized GitHub dispatch sender');
  if(request.schema!=='loc.las-published.v1'||request.repo!==LAS_REPO||
    request.target!==LOC_REPO||request.worker!=='lunarcus'||
    !SHA.test(request.sha||'')||!UUID.test(request.version||''))
    throw Error('Unexpected LAS notification identity');
  if(Object.keys(request).sort().join('|')!==[...KEYS].sort().join('|'))
    throw Error('Unexpected LAS notification fields');
  const issued=Date.parse(request.issuedAt||''),
    expires=Date.parse(request.expiresAt||'');
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||
    issued>now+60000||expires<=now||expires-issued!==300000)
    throw Error('LAS notification expired or invalid TTL');
  return request;
}
export function hasPublishedLasCheck(checks){
  return Array.isArray(checks)&&checks.some(check=>
    check.name==='Workers Builds: lunarcus'&&
    check.app?.slug==='cloudflare-workers-and-pages'&&
    check.status==='completed'&&check.conclusion==='success');
}
export function receiptPath(request){
  return 'las-deployments/'+request.version+'.json';
}
export function validateLocPagesHook(value){
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='api.cloudflare.com'||
      !/^\/client\/v4\/pages\/webhooks\/deploy_hooks\/[A-Za-z0-9_-]+$/.test(u.pathname)||
      u.search||u.hash||u.username||u.password)
      throw Error('Invalid LOC Pages deploy hook');
    return value;
  }catch{throw Error('Invalid LOC Pages deploy hook');}
}
