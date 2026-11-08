// Reused native Pages boundary for LOC-issued RS256 delegated JWTs.
// Cryptographically verify every request; never treat browser roles as grants.
import {verifyDelegationBoundary} from '../app/loc/auth/delegation-contract.mjs';
const ISSUER='https://auth.lo3rwang.cc';
const JWKS=ISSUER+'/.well-known/jwks.json';
let keys=null,expires=0,loading=null;

const error=(message,status=400)=>{
  const e=new Error(message);e.httpStatus=status;throw e;
};
function decode(value){
  if(!/^[A-Za-z0-9_-]+$/.test(String(value||'')))error('Invalid LOC token encoding',401);
  const s=atob(value.replace(/-/g,'+').replace(/_/g,'/')
    .padEnd(Math.ceil(value.length/4)*4,'='));
  return Uint8Array.from(s,character=>character.charCodeAt(0));
}
function jsonSegment(text){
  try{return JSON.parse(new TextDecoder().decode(decode(text)));}
  catch{error('Malformed LOC token',401);}
}
async function signingKeys(){
  if(keys&&Date.now()<expires)return keys;
  if(loading)return loading;
  loading=(async()=>{
    const response=await fetch(JWKS,{
      headers:{accept:'application/json'},signal:AbortSignal.timeout(6000)});
    if(!response.ok)error('LOC public signing keys unavailable',503);
    const content=await response.text();
    if(content.length>120000)error('Invalid LOC signing-key response',503);
    const payload=JSON.parse(content);
    if(!Array.isArray(payload.keys))error('LOC signing keys invalid',503);
    keys=payload.keys;
    expires=Date.now()+300000;
    return keys;
  })();
  try{return await loading;}finally{loading=null;}
}
export async function verifiedIdentity(request,env={}){
  const bearer=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
  if(!bearer)return {role:'anon',claims:{}};
  const parts=bearer[1].split('.');
  if(parts.length!==3)error('LOC signed delegation required',401);
  const header=jsonSegment(parts[0]),payload=jsonSegment(parts[1]);
  if(header?.alg!=='RS256'||typeof header.kid!=='string'||
     payload?.iss!=='loc'||payload?.aud!=='loc-delegation')
    error('Invalid LOC delegation issuer or audience',401);
  const candidates=await signingKeys();
  const jwk=candidates.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
    (!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!jwk)error('Unknown LOC signing key',401);
  let verified=false;
  try{
    const key=await crypto.subtle.importKey('jwk',jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
      decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{}
  if(!verified)error('LOC delegation signature invalid',401);
  try{
    const result=verifyDelegationBoundary(payload,{
      kind:'managed-action',name:'keyword_pattern_statistics'},{
      notBefore:String(env.LOC_DELEGATION_NOT_BEFORE||'0'),
      revokedSids:String(env.LOC_DELEGATION_REVOKED_SIDS||'')
    });
    return {role:'authenticated',claims:result.claims};
  }catch{error('LOC delegation expired or invalid',401);}
}
