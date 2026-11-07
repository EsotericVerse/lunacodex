// Standalone LOC MCP SQL Gateway (Deno 2).
// No provider Function, Data API, PostgREST or database-side RPC.
// One shared Kysely executor/driver for PostgreSQL, MySQL and SQL Server.
import {jwtVerify,createRemoteJWKSet} from 'npm:jose@5.9.6';
import {sql} from 'npm:kysely@0.29.8';
import {processShortImport,portableShortImportStore} from '../../app/loc/import/short-append-service.mjs';
import {authorizeDelegatedShortImport} from '../../app/loc/import/short-edge-authorization.mjs';
import {databaseForTarget} from '../../app/loc/providers/kysely-database-drivers.ts';
import {resolveRuntimeDatabase} from '../../app/loc/gateway/runtime-database-target.mjs';
import {executePortableMcp} from '../../app/loc/providers/kysely-mcp.mjs';
import {executeKyselyQuery} from '../../app/loc/providers/kysely-runtime.mjs';
import {delegationAudience,verifyDelegationBoundary} from '../../app/loc/auth/delegation-contract.mjs';
import {validatePublicMcpQuery} from '../../app/loc/mcp/public-sql-gate.mjs';
import {SCOPE_ROUTE_INDEX} from '../../app/modular/scope-route-index.js';

const PUBLISHED=SCOPE_ROUTE_INDEX.filter(x=>x.active&&x.scope_id!=='loc')
  .map(x=>x.scope_id);
const OPERATIONS=new Set(['mcp-read','mcp-search','mcp-sync','mcp-append']);
const BASE_HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const AUTHORITY=(()=>{
  const url=new URL(Deno.env.get('LOC_AUTHORITY_ORIGIN')||'https://auth.lo3rwang.cc');
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    !['','/'].includes(url.pathname))throw Error('Invalid trusted LOC Authority');
  return url.origin;
})();
const JWKS=createRemoteJWKSet(new URL('/.well-known/jwks.json',AUTHORITY),{
  timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:300000
});
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{
  status,headers:BASE_HEADERS
});}
function error(message:string,status=400):never{throw Object.assign(new Error(message),{httpStatus:status});}
function sourceConfig(){
  // A custom provider target is mandatory: no fallback to Supabase, Neon Auth,
  // a vendor Data API, or a user-supplied connection string.
  // A dedicated MCP profile remains optional. When absent, share the
  // server-owned LOC SQL control alias; never accept a browser-supplied URL.
  const engine=Deno.env.get('LOC_MCP_DB_ENGINE')||
    Deno.env.get('LOC_CONTROL_DB_ENGINE')||'postgres';
  const alias=Deno.env.get('LOC_MCP_DB_ALIAS')||
    Deno.env.get('LOC_CONTROL_DB_ALIAS')||'mcp_main';
  if(!['postgres','mysql','mssql'].includes(engine)||
    !/^[a-z][a-z0-9_]{0,63}$/.test(alias))
    error('Invalid portable MCP database target',503);
  const namespace=Deno.env.get('LOC_MCP_DB_NAMESPACE')||
    (engine==='postgres'?'silver':engine==='mssql'?'dbo':'');
  if(namespace&&!/^[a-z][a-z0-9_]*$/i.test(namespace))
    error('Invalid portable MCP SQL namespace',503);
  const raw=Deno.env.get('LOC_DB_CONNECTIONS_JSON');
  let profile;
  try{profile=JSON.parse(raw||'{}')?.[alias];}catch{error('Invalid server database alias configuration',503);}
  if(!profile||profile.engine!==engine||typeof profile.url!=='string')
    error('MCP database alias is not configured in server secrets',503);
  return {engine,alias,namespace,target:{
    provider:'custom',engine,connection_alias:alias,connection_mode:'direct',
    schema_name:namespace,selected:true
  }};
}
async function verifySignedDelegation(request:Request,body:Record<string,unknown>,mcpOnly=true){
  const match=/^Bearer\s+(\S+)$/.exec(request.headers.get('authorization')||'');
  if(!match)error('LOC MCP delegation required',401);
  let payload;
  try{
    ({payload}=await jwtVerify(match[1],JWKS,{
      issuer:'loc',audience:delegationAudience(body),algorithms:['RS256']
    }));
  }catch{error('Invalid or expired LOC MCP delegation',401);}
  let permission;
  try{
    permission=verifyDelegationBoundary(payload,body,{
      notBefore:Deno.env.get('LOC_DELEGATION_NOT_BEFORE')||'0',
      revokedSids:Deno.env.get('LOC_DELEGATION_REVOKED_SIDS')||''
    });
  }catch{error('Invalid delegated MCP Scope permission',403);}
  if(Boolean(permission.verifiedMcp)!==mcpOnly)
    error('LOC delegation audience does not cover this operation',403);
  return permission.claims;
}
async function handleLocMcpSqlInner(request:Request):Promise<Response>{
  try{
    const url=new URL(request.url);
    // Internal container liveness: never read the production database.
    if(url.pathname==='/health'&&request.method==='GET')
      return new Response(null,{status:204,headers:BASE_HEADERS});
    if(url.pathname!=='/v1/sql'||request.method!=='POST')
      return json({error:{message:'Not found'}},404);
    // Strictly server-side transport, without CORS or arbitrary SQL endpoints.
    if(Number(request.headers.get('content-length')||0)>650000)
      error('MCP SQL payload too large',413);
    const raw=await request.text();
    if(raw.length>650000)error('LOC SQL payload too large',413);
    let body:Record<string,unknown>;
    try{body=JSON.parse(raw);}catch{error('Invalid MCP SQL JSON',400);}
    if(!body||typeof body!=='object'||Array.isArray(body))
      error('Invalid MCP SQL request',400);
    const kind=String(body.kind||'');
    if(kind!=='short-import'&&raw.length>180000)error('MCP SQL payload too large',413);
    let claims:Record<string,unknown>|null=null;
    if(kind==='query'){
      if(request.headers.has('authorization'))
        error('Public MCP query cannot select a private delegation',403);
      validatePublicMcpQuery(body,PUBLISHED);
    }else if(OPERATIONS.has(kind)){
      claims=await verifySignedDelegation(request,body,true);
      if(body.target!==undefined&&body.target!=='configured')
        error('MCP target selection is disabled',403);
    }else if(kind==='short-import'){
      claims=await verifySignedDelegation(request,body,false);
      // The actor is always derived from a verified LOC-signed Scope write
      // delegation. No table, source identity or raw database target is
      // accepted from the Extension or website.
      authorizeDelegatedShortImport(body,claims);
    }else error('Unsupported MCP operation',403);
    // A selected database is authorized and signed by LOC Authority. The
    // verified subject chooses the SQL dialect per request, never per build.
    // Anonymous public MCP reads retain the service's default target.
    const selected=claims?await resolveRuntimeDatabase(claims,
      String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,''),{
        origin:AUTHORITY,
        serviceKey:Deno.env.get('LOC_SQL_GATEWAY_SERVICE_KEY')||''
      }):null;
    const base=selected?null:sourceConfig();
    const engine=selected?.target.engine||base!.engine;
    const namespace=selected?String(selected.target.schema_name||
      (engine==='postgres'?'silver':engine==='mssql'?'dbo':'')):base!.namespace;
    const target=selected?.target||base!.target;
    const db=await databaseForTarget(target,selected
      ?{profileLookup:async()=>selected.profile}:{});

    if(kind==='short-import'){
      const actor=authorizeDelegatedShortImport(body,claims);
      return json(await processShortImport(body.batch,actor,{
        store:portableShortImportStore(db,sql,{engine,namespace})
      }));
    }
    const result=kind==='query'
      ?await db.transaction().execute(trx=>
        executeKyselyQuery(trx,body,{dialect:engine,namespace,publicOnly:true}))
      :await db.transaction().execute(trx=>
        executePortableMcp(trx,body,claims!,{engine,namespace,provider:'custom'}));
    return json(result);
  }catch(e){
    const status=Number((e as {httpStatus?:number})?.httpStatus||500);
    const code=status>=400&&status<500?status:503;
    if(code>=500)console.error('[loc-mcp-sql] execution unavailable',e);
    return json({error:{message:code>=500?'LOC SQL Gateway unavailable':
      String(e instanceof Error?e.message:'Invalid MCP request').slice(0,190)}},code);
  }
}
// Website-owned Extension bridge can send the same LOC delegation directly.
// Narrow CORS only to the existing LOC site. MCP server-to-server calls do not
// need CORS and continue to use their own signed token.
export async function handleLocMcpSql(request:Request):Promise<Response>{
 const origin=request.headers.get('origin')||'';
 const trusted=origin==='https://loc.lo3rwang.cc';
 if(request.method==='OPTIONS')
  return trusted?new Response(null,{status:204,headers:{
   'Access-Control-Allow-Origin':origin,
   'Access-Control-Allow-Methods':'POST, OPTIONS',
   'Access-Control-Allow-Headers':'Authorization, Content-Type',
   'Access-Control-Max-Age':'300','Vary':'Origin'
  }}):new Response(null,{status:403});
 const answer=await handleLocMcpSqlInner(request);
 if(!trusted)return answer;
 const headers=new Headers(answer.headers);
 headers.set('Access-Control-Allow-Origin',origin);
 headers.set('Vary','Origin');
 return new Response(answer.body,{status:answer.status,headers});
}
if(import.meta.main)Deno.serve({port:Number(Deno.env.get('PORT')||8000)},handleLocMcpSql);
