// Dedicated Galaxy/short-import business operations inside the existing LOC
// Pages backend. This is NOT a generic SQL endpoint: no caller-provided SQL,
// relation, database alias, connection URL, or query AST is accepted.
import {sql} from 'kysely';
import {verifyAccessTokenRequest,requestToResourceInput} from 'better-auth/oauth2';
import {locPermissionsForEmail} from '../permissions/roles.mjs';
import {locMcpPermissionsForEmail,VerifiedLocUserInfoSchema} from './access-roles.mjs';
import {MANAGED_FILTER_SQL,managedFiltersValid} from '../../../zenstack/sql-input-shape.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {authorizeDelegatedShortImport} from '../import/short-edge-authorization.mjs';
import {processShortImport,portableShortImportStore} from '../import/short-append-service.mjs';
import {executePortableMcp} from '../providers/kysely-mcp.mjs';
import {executeLocConversation} from './conversations.mjs';
import {bindLocAuthorization,canManageLoc} from '../providers/loc-authorization.mjs';
import {executeManagedKyselyWrite,executeManagedKyselyAction} from '../providers/kysely-management.mjs';
import {executeCrossEngineManagedWrite} from '../providers/sql-engine-ports.mjs';
import {executeLocPersonal} from '../providers/kysely-personal.mjs';
import {directMcpKysely} from './native-kysely.mjs';
import {readBoundedJson,BodyTooLargeError} from './stream-json.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {registryRelationForEngine} from '../providers/live-database-target.mjs';
import {withFixedPolicyWrite} from '../../../zenstack/policy-runtime.mjs';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';

const AUTH='https://auth.lo3rwang.cc';
const JWKS=AUTH+'/api/auth/jwks';
const MCP_HOST='mcp.lo3rwang.cc';
const WEB_HOST='loc.lo3rwang.cc';
const MAX_BYTES=700000;
const KINDS=new Set(['mcp-sync','mcp-append','mcp-read','mcp-search','mcp-conversation','mcp-scope-status','short-import','managed-write','managed-action','personal-read','personal-write']);
// api.manage / silver.loc are the only two fixed ZModel control relations a
// signed global:manage delegation may UPDATE/DELETE (zenstack/policy-runtime.mjs
// ADMIN_FIXED_WRITES). No insert, no other table. The website retains its
// separate owner-only editor checks; MCP/Extension use active api.manage
// roles with exact Scope grants. Neither path grants global Admin by login.
function withManagedFilters(query,filters){
  if(!managedFiltersValid(filters))throw refusal('Invalid managed write filters',400);
  return filters.reduce((q,filter)=>{
    const op=MANAGED_FILTER_SQL[filter.operator];
    if(!op)throw refusal('Unsupported managed write filter',400);
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
function refusal(message,httpStatus=400){
  return Object.assign(new Error(message),{httpStatus});
}
function reply(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers});
}
// The Auth service only verifies identity/credentials. This business service
// independently looks up permissions in api.manage after connecting to Neon.
// No home-made JWT, PKCE, refresh, signing or session implementation.
async function signedClaims(request,fetchImpl){
  const host=new URL(request.url).hostname;
  if(host===WEB_HOST){
    // One shared website Session verifier; it respects the signed cookie
    // cache rather than disabling it on every Save or management action.
    const identity=await verifiedLocWebsiteSession(request,{fetchImpl});
    return {provider:'loc',role:'authenticated',sub:identity.userId,
      subject:identity.userId,email:identity.email,
      me:false,grants:[]};
  }
  const bearer=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
  if(!bearer)throw refusal('LOC OAuth bearer token required',401);
  let claims;
  try{
    claims=await verifyAccessTokenRequest(requestToResourceInput(request),{
      jwksUrl:JWKS,
      verifyOptions:{
        issuer:AUTH+'/api/auth',audience:'https://'+MCP_HOST,
        typ:'at+jwt',requiredClaims:['azp']
      },
      requiredScopes:['openid']
    });
    if(typeof claims.sub!=='string'||!claims.sub)
      throw Error('Missing Better Auth resource principal');
  }catch{throw refusal('LOC OAuth access token invalid',401)}
  const response=await fetchImpl(AUTH+'/api/auth/oauth2/userinfo',{
    method:'GET',headers:{authorization:'Bearer '+bearer[1],accept:'application/json'},
    cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)
  }).catch(()=>null);
  if(!response?.ok)throw refusal('LOC OAuth UserInfo unavailable',401);
  const checked=VerifiedLocUserInfoSchema.safeParse(
    await response.json().catch(()=>null));
  if(!checked.success||checked.data.sub!==claims.sub)
    throw refusal('Verified LOC OAuth identity required',401);
  return {provider:'loc',role:'authenticated',sub:claims.sub,
    subject:claims.sub,email:checked.data.email.trim().toLowerCase(),
    me:false,grants:[],
    delegatedScopes:String(claims.scope||'').split(/\s+/).filter(Boolean)};
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
    let body;
    try{body=await readBoundedJson(request.body,MAX_BYTES)}
    catch(error){
      throw error instanceof BodyTooLargeError
        ?refusal('Payload too large',413):refusal('Invalid JSON',400);
    }
    if(!body||typeof body!=='object'||Array.isArray(body)||
      !KINDS.has(body.kind)||typeof body.scopeid!=='string')
      throw refusal('Unsupported LOC business operation');
    // The website exposes only short-import and the fixed-model managed
    // write. MCP business operations remain restricted to the dedicated
    // MCP hostname and their own audience.
    if(host===WEB_HOST&&body.kind!=='short-import'&&body.kind!=='managed-write'&&body.kind!=='managed-action'&&body.kind!=='personal-read'&&body.kind!=='personal-write')
      throw refusal('Not found',404);
    // The verified signed claim, not the HTTP body, selects the connection.
    const claims=await signedClaims(request,fetchImpl);
    // LOC Auth verifies the identity; only active api.manage grants may
    // authorize MCP/Extension writes, never a role supplied by the request body.
    const writeKinds=new Set(['short-import','mcp-sync','mcp-append',
      'managed-write','managed-action','personal-write',
      ...(body.kind==='mcp-conversation'&&body.action==='record'?['mcp-conversation']:[])]);
    // MCP write requires both an OAuth delegation for importing and the
    // independently checked LOC business permission. OAuth alone never grants
    // writing; a read-only token cannot be promoted by a tool payload.
    if(host===MCP_HOST&&writeKinds.has(body.kind)&&
       !claims.delegatedScopes?.includes('loc:import'))
      throw refusal('LOC MCP write delegation scope required',403);
    // Write permission is checked after opening the business database.
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
    // Extension imports and direct MCP operations share the same role-based
    // Gateway gate. Website editor grants retain their existing separate policy.
    // Each request performs one active api.manage lookup, never a second probe.
    const permission=host===MCP_HOST
      ?await locMcpPermissionsForEmail(selected.db,claims.email,{dialect:selected.dialect})
      :await locPermissionsForEmail(selected.db,claims.email);
    claims.me=permission.canWrite;
    claims.grants=permission.grants;
    if(writeKinds.has(body.kind)&&!permission.canWrite)
      throw refusal('LOC write permission denied',403);
    // These fixed MCP operations are business data; no Authority-owned
    // custom Scope grants, token service, or SQL profile endpoint is involved.
    if(body.kind==='mcp-conversation'){
      if(host!==MCP_HOST)throw refusal('MCP conversation endpoint only',404);
      const result=await selected.db.transaction().execute(trx=>
        executeLocConversation(trx,body,claims));
      return reply({data:result});
    }
    if(body.kind==='mcp-scope-status'){
      if(host!==MCP_HOST)throw refusal('MCP Scope endpoint only',404);
      if(!/^[a-z][a-z0-9]{0,14}$/.test(body.scopeid))
        throw refusal('Invalid Scope',400);
      const allowed=permission.grants.includes('global:manage')||
        permission.grants.includes(body.scopeid+':read');
      if(!allowed)throw refusal('LOC Scope permission required',403);
      const row=await selected.db.selectFrom('api.manage')
        .select(['id','manage_role','active','galaxy_table','anchor_table'])
        .where('id','=',body.scopeid).executeTakeFirst();
      return reply({data:{scopeid:body.scopeid,active:row?.active===true,
        role:row?.manage_role||'',
        database:'主要資料庫連線',readable:true,
        writable:permission.grants.includes('global:manage')||
          permission.grants.includes(body.scopeid+':write')}});
    }
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
    // Reuse the grants already resolved from api.manage for this request.
    // Do not fetch the registry again inside each MCP business operation.
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
    // The client only ever sees the generic message below -- never a raw
    // connection string. Server logs may safely carry the driver's own
    // code/message (a Postgres SQLSTATE and its text, e.g. a permission or
    // RLS denial), which never include connection credentials, so this
    // failure can be told apart from a connection/config failure after the
    // fact instead of only ever showing as "database operation unavailable".
    if(status>=500)console.error('[LOC native app operation]',{
      stage:profileFailure?'db_connection':'operation',
      code:profileFailure?code:(code||'UNKNOWN'),
      detail:profileFailure?undefined:String(error?.message||'').slice(0,300)
    });
    const message=profileFailure?'LOC 主要資料庫連線尚未就緒':
      status>=500?'LOC native database operation unavailable':
      String(error?.message||'LOC request denied');
    return reply({error:{message,
      ...(profileFailure?{code,stage:'db_connection'}:{})}},
      status>=400&&status<=599?status:500);
  }
}
