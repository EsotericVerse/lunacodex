// LOC delegation boundary shared by trusted issuer, Edge and Kysely policy.
// Pure contract: no provider SDK, database client, SQL/RLS or network calls.
export const LOC_DELEGATION_ISSUER='loc';
export const LOC_DELEGATION_AUDIENCES=Object.freeze({sql:'loc-delegation',mcp:'loc-mcp'});
export const LOC_DELEGATION_MAX_SECONDS=24*60*60;
const SUBJECT=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRANT=/^[a-z][a-z0-9]{0,14}:(read|write|manage)$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const MCP_KINDS=new Set(['mcp-sync','mcp-search','mcp-read','mcp-append','mcp-update-pr']);
function reject(message){throw new Error(message)}
export function delegationAudience(request){
  return MCP_KINDS.has(String(request?.kind||''))?LOC_DELEGATION_AUDIENCES.mcp:
    LOC_DELEGATION_AUDIENCES.sql;
}
export function delegationGrants(value){
  if(!Array.isArray(value)||value.length>64||
     value.some(item=>typeof item!=='string'||!GRANT.test(item)))
    reject('Invalid LOC delegation grants');
  return [...new Set(value)];
}
export function canManageDelegation(claims,type,id=''){
  if(claims?.provider!=='loc'||claims?.me!==true)return false;
  const scope=String(id||'').toLowerCase();
  if(!['global','group','scope'].includes(type)||
     (type!=='global'&&!SCOPE.test(scope)))return false;
  const grants=claims.grants;
  if(!Array.isArray(grants))return false;
  return grants.includes('global:manage')||
    type!=='global'&&grants.includes(scope+':manage');
}
export function issueDelegation({sub,email,grants=[],audience='sql',sid,now,seconds=3600}){
  const normalized=String(email||'').trim().toLowerCase();
  if(!SUBJECT.test(String(sub||''))||!SUBJECT.test(String(sid||''))||
    !EMAIL.test(normalized)||!Object.hasOwn(LOC_DELEGATION_AUDIENCES,audience)||
    !Number.isSafeInteger(now)||!Number.isSafeInteger(seconds)||
    seconds<1||seconds>LOC_DELEGATION_MAX_SECONDS)
    reject('Invalid LOC delegation issuance');
  return {iss:LOC_DELEGATION_ISSUER,aud:LOC_DELEGATION_AUDIENCES[audience],
    sub:String(sub),email:normalized,me:true,grants:delegationGrants(grants),
    sid:String(sid),iat:now,nbf:now-5,exp:now+seconds};
}
export function verifyDelegationBoundary(payload,request,{
  now=Math.floor(Date.now()/1000),notBefore='0',revokedSids=''
}={}){
  const expectedAudience=delegationAudience(request);
  const audience=payload?.aud;
  const email=String(payload?.email||'').trim().toLowerCase();
  const sub=String(payload?.sub||''),sid=String(payload?.sid||'');
  const issued=payload?.iat,expires=payload?.exp;
  const cutoff=Number(notBefore);
  const revoked=String(revokedSids||'').split(/[\s,;]+/).filter(Boolean);
  if(payload?.iss!==LOC_DELEGATION_ISSUER||audience!==expectedAudience||
     payload?.me!==true||!SUBJECT.test(sub)||!SUBJECT.test(sid)||
     !EMAIL.test(email)||!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||
     !Number.isSafeInteger(now)||!Number.isSafeInteger(cutoff)||cutoff<0||
     issued>now+30||issued<cutoff||expires<=now||expires<=issued||
     expires-issued>LOC_DELEGATION_MAX_SECONDS||
     revoked.length>1000||revoked.some(value=>!SUBJECT.test(value))||
     revoked.includes(sid))
    reject('Invalid or revoked LOC delegation');
  const grants=delegationGrants(payload.grants);
  const mcp=expectedAudience===LOC_DELEGATION_AUDIENCES.mcp;
  let scopedWriteGrant='';
  if(mcp){
    const scope=String(request?.scopeid||'');
    const kind=String(request?.kind||'');
    const site=kind==='mcp-read'?String(request?.site||'mcp'):'mcp';
    if(!SCOPE.test(scope)||!['mcp','github'].includes(site))
      reject('Invalid delegated MCP resource');
    const needed=kind==='mcp-update-pr'||site==='github'?'manage':
      kind==='mcp-read'||kind==='mcp-search'?'read':'write';
    if(!grants.includes(scope+':'+needed))
      reject('MCP delegation does not cover this operation');
    // Internal managed write uses the existing Scope-management branch.
    // This in-memory permission is specific to the already verified MCP request.
    if(needed==='write')scopedWriteGrant=scope+':manage';
  }
  return {claims:{role:'authenticated',provider:'loc',me:true,sub,email,
    iss:LOC_DELEGATION_ISSUER,sid,jti:String(payload.jti||''),exp:expires,
    grants:scopedWriteGrant?[...grants,scopedWriteGrant]:grants},
    verifiedMcp:mcp};
}
