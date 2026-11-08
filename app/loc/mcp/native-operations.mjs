// Dedicated Galaxy/short-import business operations inside the existing LOC
// Pages backend. This is NOT a generic SQL endpoint: no caller-provided SQL,
// relation, database alias, connection URL, or query AST is accepted.
import {sql} from 'kysely';
import {verifyDelegationBoundary} from '../auth/delegation-contract.mjs';
import {authorizeDelegatedShortImport} from '../import/short-edge-authorization.mjs';
import {processShortImport,portableShortImportStore} from '../import/short-append-service.mjs';
import {executePortableMcp} from '../providers/kysely-mcp.mjs';
import {directMcpKysely} from './native-kysely.mjs';

const JWKS='https://auth.lo3rwang.cc/.well-known/jwks.json';
const MCP_HOST='mcp.lo3rwang.cc';
const WEB_HOST='loc.lo3rwang.cc';
const MAX_BYTES=700000;
const KINDS=new Set(['mcp-sync','mcp-append','mcp-read','mcp-search','short-import']);
const headers={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const txt=new TextEncoder();
const utf=new TextDecoder();
let publicKeys=null;
let keyExpires=0;

function refusal(message,httpStatus=400){
  return Object.assign(new Error(message),{httpStatus});
}
function reply(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers});
}
function bytes(part){
  if(typeof part!=='string'||!/^[A-Za-z0-9_-]+$/.test(part)||part.length>12000)
    throw refusal('Invalid LOC delegation encoding',401);
  const decoded=atob(part.replace(/-/g,'+').replace(/_/g,'/')
    .padEnd(Math.ceil(part.length/4)*4,'='));
  return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
function jsonSegment(part){
  try{return JSON.parse(utf.decode(bytes(part)))}catch{
    throw refusal('Invalid LOC delegation JSON',401);
  }
}
async function signingKey(kid,fetchImpl){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(kid||'')))
    throw refusal('Invalid LOC signing key',401);
  const now=Date.now();
  let keys=publicKeys;
  if(!keys||now>=keyExpires||!keys.some(k=>k.kid===kid)){
    const response=await fetchImpl(JWKS,{headers:{accept:'application/json'},
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw refusal('LOC Auth signing keys unavailable',503);
    const jwks=await response.json().catch(()=>null);
    if(!Array.isArray(jwks?.keys)||jwks.keys.length>20)
      throw refusal('Invalid LOC Auth signing keys',503);
    publicKeys=jwks.keys;
    keyExpires=now+60000;
    keys=publicKeys;
  }
  const jwk=keys.find(k=>k.kid===kid&&k.kty==='RSA'&&k.alg==='RS256'&&
    k.use==='sig'&&typeof k.n==='string'&&typeof k.e==='string');
  if(!jwk)throw refusal('LOC delegation signer not trusted',401);
  return crypto.subtle.importKey('jwk',jwk,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
}
async function signedClaims(authorization,body,env,fetchImpl){
  const match=/^Bearer\s+([A-Za-z0-9_.-]{30,8192})$/i.exec(String(authorization||''));
  if(!match)throw refusal('Signed LOC delegation required',401);
  const pieces=match[1].split('.');
  if(pieces.length!==3)throw refusal('Invalid LOC delegation',401);
  const header=jsonSegment(pieces[0]);
  if(header?.alg!=='RS256'||header?.typ!=='JWT')
    throw refusal('Unsupported LOC delegation signature',401);
  const key=await signingKey(header.kid,fetchImpl);
  const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
    bytes(pieces[2]),txt.encode(pieces[0]+'.'+pieces[1]));
  if(!verified)throw refusal('LOC delegation signature mismatch',401);
  const payload=jsonSegment(pieces[1]);
  try{return verifyDelegationBoundary(payload,body,{
    notBefore:env.LOC_DELEGATION_NOT_BEFORE||'0',
    revokedSids:env.LOC_DELEGATION_REVOKED_SIDS||''
  }).claims;}catch{throw refusal('LOC Scope delegation denied or expired',403);}
}
export async function handleNativeLocOperation(request,env={},{
  fetchImpl=globalThis.fetch,database=directMcpKysely
}={}){
  if(request.method!=='POST')return reply({error:{message:'Method not allowed'}},405);
  const host=new URL(request.url).hostname;
  if(host!==MCP_HOST&&host!==WEB_HOST)
    return reply({error:{message:'Not found'}},404);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
    return reply({error:{message:'JSON body required'}},415);
  if(Number(request.headers.get('content-length')||0)>MAX_BYTES)
    return reply({error:{message:'Payload too large'}},413);
  try{
    const raw=await request.text();
    if(txt.encode(raw).byteLength>MAX_BYTES)
      throw refusal('Payload too large',413);
    let body;
    try{body=JSON.parse(raw);}catch{throw refusal('Invalid JSON');}
    if(!body||typeof body!=='object'||Array.isArray(body)||
      !KINDS.has(body.kind)||typeof body.scopeid!=='string')
      throw refusal('Unsupported LOC business operation');
    // The website exposes only short-import. MCP business operations remain
    // restricted to the dedicated MCP hostname and their own audience.
    if(host===WEB_HOST&&body.kind!=='short-import')
      throw refusal('Not found',404);
    // The verified signed claim, not the HTTP body, selects the connection.
    const claims=await signedClaims(request.headers.get('authorization'),
      body,env,fetchImpl);
    const selected=await database(env,claims.db_target||'');
    if(!selected?.db||!['postgres','mysql','mssql'].includes(selected.engine))
      throw refusal('LOC native Kysely driver is not configured',503);
    if(body.kind==='short-import'){
      if(selected.tableName)throw refusal('External mapped tables are read only',403);
      const actor=authorizeDelegatedShortImport(body,claims);
      const receipt=await processShortImport(body.batch,actor,{
        store:portableShortImportStore(selected.db,sql,{
          engine:selected.engine,namespace:selected.namespace})
      });
      return reply(receipt);
    }
    const result=await executePortableMcp(selected.db,body,claims,{
      engine:selected.engine,namespace:selected.namespace,
      tableName:selected.tableName,fieldMap:selected.fieldMap});
    return reply({data:result.data});
  }catch(error){
    const status=Number(error?.httpStatus)||500;
    if(status>=500)console.error('[LOC native app operation]',String(error?.message||error));
    return reply({error:{message:status>=500?'LOC native database operation unavailable':
      String(error?.message||'LOC request denied')}},status>=400&&status<=599?status:500);
  }
}
