// Dedicated Galaxy/short-import business operations inside the existing LOC
// Pages backend. This is NOT a generic SQL endpoint: no caller-provided SQL,
// relation, database alias, connection URL, or query AST is accepted.
import {sql} from 'kysely';
import {verifyDelegationBoundary} from '../auth/delegation-contract.mjs';
import {authorizeDelegatedShortImport} from '../import/short-edge-authorization.mjs';
import {processShortImport,portableShortImportStore} from '../import/short-append-service.mjs';
import {executePortableMcp} from '../providers/kysely-mcp.mjs';
import {bindLocAuthorization,canManageLoc} from '../providers/loc-authorization.mjs';
import {executeManagedKyselyWrite,executeManagedKyselyAction} from '../providers/kysely-management.mjs';
import {executeCrossEngineManagedWrite} from '../providers/sql-engine-ports.mjs';
import {executeLocPersonal} from '../providers/kysely-personal.mjs';
import {directMcpKysely} from './native-kysely.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {registryRelationForEngine} from '../providers/live-database-target.mjs';
import {withFixedPolicyWrite} from '../../../zenstack/policy-runtime.mjs';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';

const JWKS='https://auth.lo3rwang.cc/.well-known/jwks.json';
const MCP_HOST='mcp.lo3rwang.cc';
const WEB_HOST='loc.lo3rwang.cc';
const MAX_BYTES=700000;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KINDS=new Set(['mcp-sync','mcp-append','mcp-read','mcp-search','short-import','managed-write','managed-action','personal-read','personal-write']);
// api.manage / silver.loc are the only two fixed ZModel control relations a
// signed global:manage delegation may UPDATE/DELETE (zenstack/policy-runtime.mjs
// ADMIN_FIXED_WRITES). No insert, no other table -- the website's own
// RLS-free database relies entirely on this gate (AGENTS.md 2026-11-09:
// only the verified LOC owner "me" may INSERT/UPDATE/DELETE).
const FILTER_SQL_OP={eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
  like:'like',ilike:'ilike',is:'is',in:'in'};
function withManagedFilters(query,filters){
  return filters.reduce((q,filter)=>{
    const op=FILTER_SQL_OP[filter?.operator];
    if(!op)throw refusal('Unsupported managed write filter: '+filter?.operator,400);
    return q.where(filter.column,op,filter.value);
  },query);
}
async function applyManagedWrite(qb,modelName,payload){
  const filters=Array.isArray(payload?.p_filters)?payload.p_filters:[];
  if(!filters.length)throw refusal('Unsafe unfiltered managed write',400);
  if(payload.p_operation==='update'){
    const values=payload.p_values;
    if(!values||typeof values!=='object'||Array.isArray(values))
      throw refusal('Invalid managed write values',400);
    const result=await withManagedFilters(qb.updateTable(modelName).set(values),filters)
      .executeTakeFirst();
    return {count:Number(result?.numUpdatedRows||0)};
  }
  if(payload.p_operation==='delete'){
    const result=await withManagedFilters(qb.deleteFrom(modelName),filters).executeTakeFirst();
    return {count:Number(result?.numDeletedRows||0)};
  }
  throw refusal('Unsupported managed write operation',400);
}
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
      redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(7000)});
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
    // The website exposes only short-import and the fixed-model managed
    // write. MCP business operations remain restricted to the dedicated
    // MCP hostname and their own audience.
    if(host===WEB_HOST&&body.kind!=='short-import'&&body.kind!=='managed-write'&&body.kind!=='managed-action'&&body.kind!=='personal-read'&&body.kind!=='personal-write')
      throw refusal('Not found',404);
    // The verified signed claim, not the HTTP body, selects the connection.
    const claims=await signedClaims(request.headers.get('authorization'),
      body,env,fetchImpl);
    // Only the verified LOC owner can mutate any LOC data. The token's email
    // and grants are signed by LOC Auth, never accepted from the HTTP body.
    const writeKinds=new Set(['short-import','mcp-sync','mcp-append',
      'managed-write','managed-action','personal-write']);
    if(writeKinds.has(body.kind)&&(
       claims.provider!=='loc'||claims.me!==true||
       String(claims.email||'').trim().toLowerCase()!=='sopa2306@gmail.com'))
      throw refusal('Only the verified LOC owner may write',403);
    // External user-selected connections are READ ONLY, whether they map an
    // existing table or expose the ordinary Scope schema. This includes the
    // extension import path and MCP append/sync. OAuth never changes this.
    const writesToSelectedDatabase=['short-import','mcp-sync','mcp-append']
      .includes(body.kind);
    const primaryId=DATABASE_ACCESS_LIST.find(item=>item.selected===true)?.target_id;
    if(writesToSelectedDatabase&&claims.db_target&&claims.db_target!==primaryId)
      throw refusal('External database connections are read only',403);
    // Personal preferences and Admin settings always use LOC's control
    // database. A user's selected external database is for their Scope data,
    // never for api.loc_user / api.user_settings / api.manage.
    const control=['personal-read','personal-write','managed-write','managed-action']
      .includes(body.kind);
    const externalTarget=claims.db_target&&claims.db_target!==primaryId
      ?claims.db_target:'';
    const selected=await database(env,control?'':externalTarget);
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
    if(body.kind==='personal-read'||body.kind==='personal-write'){
      if(host!==WEB_HOST)throw refusal('Personal records belong to the LOC website',404);
      if(selected.tableName||selected.engine!=='postgres')
        throw refusal('LOC personal database connection unavailable',503);
      // An identity-only signed LOC OAuth delegation has zero management
      // grants. The Kysely query is constrained to its own owner_id, not RLS.
      const row=await selected.db.transaction().execute(trx=>
        executeLocPersonal(trx,claims,body));
      return reply({data:row});
    }
    if(body.kind==='managed-write'||body.kind==='managed-action'){
      if(selected.tableName)throw refusal('External mapped tables are read only',403);
      if(!claims.grants?.some(grant=>grant==='global:manage'||grant.endsWith(':manage')))
        throw refusal('LOC management delegation required',403);
      // PostgreSQL fixed-model mutations keep the existing ZenStack policy
      // path. For a non-PostgreSQL MAIN database, use the already installed
      // portable Kysely writer only after rechecking api.manage in the same
      // transaction. Neither external targets nor arbitrary SQL are writable.
      const payload=body.payload||{};
      if(selected.engine!=='postgres'){
        if(body.kind!=='managed-write')
          throw refusal('This LOC management action needs a portable implementation',503);
        const row=await selected.db.transaction().execute(async trx=>{
          bindLocAuthorization(trx,{role:claims.role,claims,engine:selected.engine});
          if(payload.p_table==='api.manage'){
            if(!claims.grants.includes('global:manage')||
                !await canManageLoc(trx,'global'))
              throw refusal('LOC Registry management permission denied',403);
            if(!['update','delete'].includes(payload.p_operation))
              throw refusal('Registry mutation requires a fixed operation',403);
            if(!Array.isArray(payload.p_filters)||!payload.p_filters.length)
              throw refusal('Unsafe unfiltered managed write',400);
            return applyManagedWrite(trx,
              registryRelationForEngine(selected.engine),payload);
          }
          return (await executeCrossEngineManagedWrite(trx,body,{
            engine:selected.engine,namespace:selected.namespace,
            role:claims.role,claims
          })).data;
        });
        return reply({data:row});
      }
      // Keep the fixed-model ZenStack policy path for UPDATE and DELETE.
      // All other known LOC tables use the existing Kysely management
      // executor, with the signed principal bound to this transaction.
      const fixed=body.kind==='managed-write'&&
        ['api.manage','silver.loc'].includes(payload.p_table)&&
        ['update','delete'].includes(payload.p_operation);
      if(fixed){
        if(!selected.dialect)throw refusal('LOC native Kysely driver is not configured',503);
        const row=await withFixedPolicyWrite(selected.db,{engine:selected.engine},
          body,claims.role,claims,
          {dialect:selected.dialect,ZenStackClient,PolicyPlugin},
          async(qb,modelName)=>{
              if(!Array.isArray(payload.p_filters)||!payload.p_filters.length)
                throw refusal('Unsafe unfiltered managed write',400);
              // api.manage remains the live source of management rights in
             // the same Kysely transaction as the ZenStack-model write.
             bindLocAuthorization(qb,{role:claims.role,claims});
             if(!await canManageLoc(qb,'global','','Manage'))
               throw refusal('LOC Registry management permission denied',403);
             return applyManagedWrite(qb,modelName,payload);
           });
        return reply({data:row});
      }
      const row=await selected.db.transaction().execute(async trx=>{
        bindLocAuthorization(trx,{role:claims.role,claims,engine:selected.engine});
        return body.kind==='managed-write'
          ?(await executeManagedKyselyWrite(trx,body)).data
          :(await executeManagedKyselyAction(trx,body,claims)).data;
      });
      return reply({data:row});
    }
    const runMcp=db=>executePortableMcp(db,body,claims,{
      engine:selected.engine,namespace:selected.namespace,
      tableName:selected.tableName,fieldMap:selected.fieldMap});
    // The signed LOC Owner delegation is the only write permission. Never
    // query api.manage merely to authorize the same identity a second time.
    if(body.kind==='mcp-sync'||body.kind==='mcp-append'){
      if(selected.tableName)
        throw refusal('LOC MCP control database is unavailable for writing',503);
      const result=await selected.db.transaction().execute(trx=>runMcp(trx));
      return reply({data:result.data});
    }
    const result=await runMcp(selected.db);
    return reply({data:result.data});
  }catch(error){
    // A trusted Authority Profile failure has a stable, non-secret code.
    // Do not turn a missing primary connection into an unrelated HTTP 500,
    // and never forward raw connection strings or SQL driver messages.
    const profileCodes=new Set(['PRIMARY_TARGET_MISSING','PRIMARY_TARGET_INVALID',
      'DATABASE_TARGET_MISSING','SQL_VERIFICATION_REQUIRED',
      'PROFILE_HTTP_403','PROFILE_HTTP_404','PROFILE_HTTP_423','PROFILE_HTTP_503']);
    const code=String(error?.code||'');
    const profileFailure=profileCodes.has(code);
    const status=profileFailure
      ?(code==='SQL_VERIFICATION_REQUIRED'||code==='PROFILE_HTTP_423'?423:503)
      :Number(error?.httpStatus)||500;
    if(status>=500)console.error('[LOC native app operation]',{
      stage:profileFailure?'db_connection':'operation',
      code:profileFailure?code:'OPERATION_FAILED'
    });
    const message=profileFailure?'LOC 主要資料庫連線尚未就緒':
      status>=500?'LOC native database operation unavailable':
      String(error?.message||'LOC request denied');
    return reply({error:{message,
      ...(profileFailure?{code,stage:'db_connection'}:{})}},
      status>=400&&status<=599?status:500);
  }
}
