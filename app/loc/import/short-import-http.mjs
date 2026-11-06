import {processShortImport,postgresShortImportStore} from './short-append-service.mjs';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','x-content-type-options':'nosniff'};
function json(value,status=200,headers={}){return new Response(JSON.stringify(value),
 {status,headers:{...JSON_HEADERS,...headers}});}
// LOC Auth mounts this handler at /v1/import/short. The verified actor is NOT
// supplied in the request JSON: verifyAccessToken must validate issuer,
// signature, audience, expiry, revocation and Scope-specific loc:import grants.
// No verifier or database writer => fail closed with HTTP 503, never accept.
export function createShortImportHttpHandler({verifyAccessToken,store,
 cryptoProvider=globalThis.crypto,uidFactory}={}){
 return async function shortImport(request){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(typeof verifyAccessToken!=='function'||!store)
   return json({error:'LOC Auth short-import backend not configured'},503);
  const type=request.headers.get('content-type')||'';
  if(!/^application\/json(?:\s*;|$)/i.test(type))
   return json({error:'Content-Type must be application/json'},415);
  const bearer=request.headers.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9._~+/-]{30,8192})$/.exec(bearer);
  if(!match)return json({error:'LOC import token required'},401);
  let actor;
  try{actor=await verifyAccessToken(match[1]);}
  catch{return json({error:'LOC import authorization failed'},401);}
  // The verifier's trusted output must be independent of body.actor/scopeid.
  if(actor?.authorized!==true||!actor.subject||!actor.scopeid)
   return json({error:'LOC import permission denied'},403);
  let batch;
  try{
   const raw=await request.text();
   if(new TextEncoder().encode(raw).byteLength>650000)
    return json({error:'Import batch too large'},413);
   batch=JSON.parse(raw);
  }catch{return json({error:'Malformed import JSON'},400);}
  try{
   const reply=await processShortImport(batch,actor,
    {store,cryptoProvider,...(uidFactory?{uidFactory}:{})});
   return json(reply,200);
  }catch(error){
   const status=Number(error?.httpStatus)||500;
   if(status>=500)console.error('[LOC short-import] failed',error?.message);
   return json({error:status>=500?'Short-import service unavailable':
    String(error.message||'Invalid import batch')},
    status>=400&&status<600?status:500,
    status===429?{'retry-after':String(error.retryAfter||900)}:{});
  }
 };
}
// Installed Edge Kysely db/sql can be injected directly after LOC Auth
// verifies the user; the batch then executes in ONE database transaction.
export function createKyselyShortImportHttpHandler({verifyAccessToken,db,sql,...rest}={}){
 const store=db&&sql?postgresShortImportStore(db,sql):null;
 return createShortImportHttpHandler({verifyAccessToken,store,...rest});
}
