// Dedicated Galaxy/short-import business operations inside the existing LOC
// Pages backend. This is NOT a generic SQL endpoint: no caller-provided SQL,
// relation, database alias, connection URL, or query AST is accepted.
import {sql} from 'kysely';
import {classifyShortImportFailure} from '../import/import-failure-code.mjs';
import {verifyAccessTokenRequest,requestToResourceInput} from 'better-auth/oauth2';
import {readLocAccess} from '../permissions/loc_access.mjs';
import {loadMcpLocAccess,VerifiedLocUserInfoSchema} from './access-roles.mjs';
import {MANAGED_FILTER_SQL,managedFiltersValid} from '../../../packages/zenstack/sql-input-shape.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {authorizeDelegatedShortImport} from '../import/short-edge-authorization.mjs';
import {processShortImport,portableShortImportStore} from '../import/short-append-service.mjs';
import {executePortableMcp} from '../providers/kysely-mcp.mjs';
import {executeLocConversation} from './conversations.mjs';
import {readMemory as readPublicGalaxy} from './galaxy-read.mjs';
import {articleDistribution} from './article-distribution.mjs';
import {bindLocAuthorization,canLocAccess} from '../providers/loc-authorization.mjs';
import {executeManagedKyselyWrite,executeManagedKyselyAction} from '../providers/kysely-management.mjs';
import {executeCrossEngineManagedWrite} from '../providers/sql-engine-ports.mjs';
import {executeLocPersonal} from '../providers/kysely-personal.mjs';
import {synchronizeKeywordLibraryInTransaction} from '../keywords/sql-service.mjs';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from './native-kysely.mjs';
import {readBoundedJson,BodyTooLargeError} from './stream-json.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {registryRelationForEngine} from '../providers/live-database-target.mjs';
import {fixedPolicyWriteModel} from '../../../packages/zenstack/policy-runtime.mjs';

const AUTH='https://auth.lo3rwang.cc';
const JWKS=AUTH+'/api/auth/jwks';
const MCP_HOST='mcp.lo3rwang.cc';
const WEB_HOST='loc.lo3rwang.cc';
const MAX_BYTES=700000;
const KINDS=new Set(['mcp-sync','mcp-append','mcp-read','mcp-search','mcp-conversation','mcp-scope-status','mcp-authorize','mcp-public-read','mcp-article-stat','short-import','managed-write','managed-transaction','managed-action','personal-read','personal-write']);
// api.manage / silver.loc are the only two fixed ZModel control relations a
// signed global:manage delegation may UPDATE/DELETE (packages/zenstack/policy-runtime.mjs
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
async function signedClaims(request,fetchImpl,{trustedMcpBridge=false}={}){
  const host=new URL(request.url).hostname;
  if(host===WEB_HOST&&!trustedMcpBridge){
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
  let response;
  try{
    response=await fetchImpl(AUTH+'/api/auth/oauth2/userinfo',{
      method:'GET',headers:{authorization:'Bearer '+bearer[1],accept:'application/json'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)
    });
  }catch{throw refusal('LOC OAuth UserInfo unavailable',503)}
  // Auth Worker failures are NOT proof of revoked credentials. Returning 401
  // would cause the Extension to rotate tokens and pause a durable Queue.
  if(response?.status===429)throw refusal('LOC OAuth UserInfo rate limited',429);
  if(response?.status===401||response?.status===403)
    throw refusal('LOC OAuth identity verification failed',401);
  if(!response?.ok)throw refusal('LOC OAuth UserInfo unavailable',503);
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
  fetchImpl=globalThis.fetch,database=directMcpKysely,waitUntil,
  trustedMcpBridge=false
}={}){
  if(request.method!=='POST')return reply({error:{message:'Method not allowed'}},405);
  const requestHost=new URL(request.url).hostname;
  // Only functions/api/las-native.js may set this server-side option.
  // The real URL stays on LOC Pages, avoiding Cloudflare Request re-wrapping
  // and any network round trip. OAuth still needs the canonical MCP audience.
  const host=trustedMcpBridge&&requestHost===WEB_HOST?MCP_HOST:requestHost;
  if(host!==MCP_HOST&&host!==WEB_HOST)
    return reply({error:{message:'Not found'}},404);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
    return reply({error:{message:'JSON body required'}},415);
  if(Number(request.headers.get('content-length')||0)>MAX_BYTES)
    return reply({error:{message:'Payload too large'}},413);
  let operationKind='',importPhase='request';
  let selected=null;
  let releaseAbort=()=>{};
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
    operationKind=body.kind;
    if(operationKind==='short-import')importPhase='identity';
    // The website exposes only short-import and the fixed-model managed
    // write. MCP business operations remain restricted to the dedicated
    // MCP hostname and their own audience.
    if(host===WEB_HOST&&body.kind!=='short-import'&&body.kind!=='managed-write'&&body.kind!=='managed-transaction'&&body.kind!=='managed-action'&&body.kind!=='personal-read'&&body.kind!=='personal-write')
      throw refusal('Not found',404);
    // The LOC administrator creates and removes SQL Scopes only through
    // the verified Web Session. Do not expose DDL through MCP OAuth delegates.
    if(body.kind==='managed-action'&&
      ['provision_scope','manage_scope_registry','delete_scope'].includes(body.name)&&
      host!==WEB_HOST)throw refusal('LOC Scope lifecycle is website-only',403);
    // The media importer is a website-only read for existing behavior, NOT an
    // additional MCP/Gateway operation or delegated authorization scope.
    if(body.kind==='managed-action'&&
       ['media_anchor_candidates','anchor_import_page','import_site_presence',
         'search_galaxy_private','save_scope_trace_edit'].includes(body.name)&&host!==WEB_HOST)
      throw refusal('Not found',404);
    // The verified signed claim, not the HTTP body, selects the connection.
    const claims=await signedClaims(request,fetchImpl,{trustedMcpBridge:host===MCP_HOST});
    // LOC Auth verifies the identity; only active api.manage grants may
    // authorize MCP/Extension writes, never a role supplied by the request body.
    const writeKinds=new Set(['short-import','mcp-sync','mcp-append',
      'managed-write','managed-transaction','managed-action',
      ...(body.kind==='mcp-conversation'&&['record','record_ordered'].includes(body.action)?['mcp-conversation']:[])]);
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
    // never for silver.loc_user / api.manage.
    const control=['personal-read','personal-write','managed-write','managed-transaction','managed-action']
      .includes(body.kind);
    const externalTarget=claims.db_target&&claims.db_target!==primaryId
      ?claims.db_target:'';
    if(operationKind==='short-import')importPhase='database';
    selected=await database(env,control?'':externalTarget,{waitUntil});
    // Cancellation belongs to the request, not to whichever page initiated it.
    // Closing an in-flight client aborts its uncommitted SQL transaction.
    releaseAbort=bindLocRequestAbort(selected,request.signal);
    if(!selected?.db||!['postgres','mysql','mssql'].includes(selected.engine))
      throw refusal('LOC native Kysely driver is not configured',503);
    // Personal preferences are self-service under the verified website Session.
    // The signed subject is bound to owner_id by executeLocPersonal; no
    // api.manage role lookup or editor delegation is required for this path.
    if(body.kind==='personal-read'||body.kind==='personal-write'){
      if(host!==WEB_HOST)throw refusal('Personal records belong to the LOC website',404);
      if(selected.tableName||selected.engine!=='postgres')
        throw refusal('LOC personal database connection unavailable',503);
      const row=await selected.db.transaction().execute(trx=>
        executeLocPersonal(trx,claims,body));
      return reply({data:row});
    }
    // A normal Search toggle never asks for edit grants. Only when a search
    // is submitted does OAuth establish the owner and loc_user opt into a
    // private read; only then may the business Scope eligibility be checked.
    // Extension imports and direct MCP operations share the same role-based
    // Gateway gate. Website editor grants retain their existing separate policy.
    // Each request performs one active api.manage lookup, never a second probe.
    if(operationKind==='short-import')importPhase='permission';
    // Managed batches resolve their one authorization snapshot inside the
    // SAME transaction as all of their writes, not in a preceding query.
    const isManagedBatch=['managed-transaction','managed-write','managed-action',
      'mcp-conversation','mcp-scope-status','mcp-sync','mcp-append',
      'mcp-public-read','mcp-article-stat','mcp-read','mcp-search']
      .includes(body.kind);
    let permission=null;
    if(!isManagedBatch){
      permission=host===MCP_HOST
        ?await loadMcpLocAccess(selected.db,claims.email,{dialect:selected.dialect,engine:selected.engine})
        :await readLocAccess(selected.db,claims.email,{dialect:selected.dialect,engine:selected.engine,website:true});
      claims.me=permission.canWrite;
      claims.grants=permission.grants;
      if(writeKinds.has(body.kind)&&!permission.canWrite)
        throw refusal('LOC write permission denied',403);
    }
    // These fixed MCP operations are business data; no Authority-owned
    // custom Scope grants, token service, or SQL profile endpoint is involved.
    // LAS asks LOC to resolve its existing active api.manage eligibility. 
    // This is a read-only check, not a new grant or role registry.
    if(body.kind==='mcp-authorize'){
      if(host!==MCP_HOST)throw refusal('MCP authorization only',404);
      if(!permission.roles?.length)throw refusal('LOC MCP role not granted',403);
      return reply({data:{authorized:true}});
    }
    // Galaxy data and statistics remain owned by LOC. LAS only maps request
    // envelopes and forwards a verified OAuth bearer to these fixed operations.
    if(body.kind==='mcp-public-read'){
      if(host!==MCP_HOST)throw refusal('MCP public read only',404);
      const args=body.args||{};
      if(args.scopeid!==undefined&&args.scopeid!==body.scopeid)
        throw refusal('MCP Scope mismatch',400);
      const data=await selected.db.transaction()
        .setIsolationLevel('repeatable read').execute(async trx=>{
          const rights=await loadMcpLocAccess(trx,claims.email,{
            dialect:selected.dialect,engine:selected.engine,transactional:true});
          claims.me=rights.canWrite;claims.grants=rights.grants;
          // Public Galaxy predicates and columns remain fixed by the ZModel
          // reader. Bind its Kysely query to this already-open transaction.
          return readPublicGalaxy({...args,scopeid:body.scopeid},env,{
            waitUntil,databasePort:{...selected,db:trx,dialect:null}
          });
        });
      return reply({data});
    }
    if(body.kind==='mcp-article-stat'){
      if(host!==MCP_HOST||body.scopeid!=='loc')
        throw refusal('Invalid MCP article statistics scope',400);
      const data=await selected.db.transaction()
        .setIsolationLevel('repeatable read').execute(async trx=>{
          const rights=await loadMcpLocAccess(trx,claims.email,{
            dialect:selected.dialect,engine:selected.engine,transactional:true});
          claims.me=rights.canWrite;claims.grants=rights.grants;
          return articleDistribution(body.args||{},env,{
            database:async()=>({...selected,db:trx}),
            borrowed:true,inTransaction:true
          });
        });
      return reply({data});
    }
    if(body.kind==='mcp-conversation'){
      if(host!==MCP_HOST)throw refusal('MCP conversation endpoint only',404);
      const result=await selected.db.transaction().execute(async trx=>{
        const rights=await loadMcpLocAccess(trx,claims.email,{
          dialect:selected.dialect,engine:selected.engine,transactional:true});
        claims.me=rights.canWrite;claims.grants=rights.grants;
        if(writeKinds.has(body.kind)&&!rights.canWrite)
          throw refusal('LOC write permission denied',403);
        return executeLocConversation(trx,body,claims);
      });
      return reply({data:result});
    }
    if(body.kind==='mcp-scope-status'){
      if(host!==MCP_HOST)throw refusal('MCP Scope endpoint only',404);
      if(!/^[a-z][a-z0-9]{0,14}$/.test(body.scopeid))
        throw refusal('Invalid Scope',400);
      const data=await selected.db.transaction().execute(async trx=>{
        const rights=await loadMcpLocAccess(trx,claims.email,{
          dialect:selected.dialect,engine:selected.engine,transactional:true});
        claims.me=rights.canWrite;claims.grants=rights.grants;
        const allowed=rights.grants.includes('global:manage')||
          rights.grants.includes(body.scopeid+':read');
        if(!allowed)throw refusal('LOC Scope permission required',403);
        const row=await trx.selectFrom('api.manage')
          .select(['id','manage_role','active','galaxy_table','anchor_table'])
          .where('id','=',body.scopeid).executeTakeFirst();
        return {scopeid:body.scopeid,active:row?.active===true,
          role:row?.manage_role||'',database:'主要資料庫連線',readable:true,
          writable:rights.grants.includes('global:manage')||
            rights.grants.includes(body.scopeid+':write')};
      });
      return reply({data});
    }
    if(body.kind==='short-import'){
      if(selected.tableName)throw refusal('External mapped tables are read only',403);
      importPhase='delegation';
      const actor=authorizeDelegatedShortImport(body,claims);
      importPhase='validation';
      const receipt=await processShortImport(body.batch,actor,{
        store:portableShortImportStore(selected.db,sql,{
          engine:selected.engine,namespace:selected.namespace,
          onPhase:phase=>{importPhase=phase;}})
      });
      return reply(receipt);
    }
    if(body.kind==='managed-transaction'){
      // One HTTP request, one established LOC business principal, one SQL
      // transaction. The request-size boundary limits the total workload;
      // there is no arbitrary operation-count cap or separate auth channel.
      if(selected.tableName)throw refusal('External mapped tables are read only',403);
      const operations=body.operations;
      const keywordSyncScope=String(body.keywordSyncScope||'');
      // Explicit purpose-only reconciliation: the caller may batch only that
      // Scope's own Anchor and configuration edits. This is not generic SQL.
      if(keywordSyncScope&&(
        !/^[a-z][a-z0-9]{0,14}$/.test(keywordSyncScope)||
        operations?.some(item=>![
          'silver.'+keywordSyncScope+'_anchor','silver.'+keywordSyncScope
        ].includes(item?.p_table))))
        throw refusal('Keyword reconciliation Scope mismatch',400);
      if(body.scopeid!==''||!Array.isArray(operations)||operations.length<1||
        operations.some(entry=>!entry||typeof entry!=='object'||
          Array.isArray(entry)||!['insert','update','delete','upsert','append_media_link'].includes(entry.p_operation)||
          typeof entry.p_table!=='string'))
        throw refusal('Invalid LOC management transaction',400);
      const results=await selected.db.transaction().execute(async trx=>{
        const verifiedRights=host===MCP_HOST
          ?await loadMcpLocAccess(trx,claims.email,{
            dialect:selected.dialect,engine:selected.engine,transactional:true})
          :await readLocAccess(trx,claims.email,{
            dialect:selected.dialect,engine:selected.engine,website:true,transactional:true});
        claims.me=verifiedRights.canWrite;
        claims.grants=verifiedRights.grants;
        if(!verifiedRights.canWrite||!claims.grants.some(grant=>
          grant==='global:manage'||grant.endsWith(':manage')))
          throw refusal('LOC management delegation required',403);
        bindLocAuthorization(trx,{role:claims.role,claims,engine:selected.engine});
        const outcomes=[];
        for(const payload of operations){
          if(payload.p_operation==='append_media_link'&&(
            selected.engine!=='postgres'||host!==WEB_HOST))
            throw refusal('MediaAnchor link is LOC Web PostgreSQL-only',403);
          const fixed=['api.manage','silver.loc'].includes(payload.p_table);
          const action={kind:'managed-write',payload};
          let output;
          if(fixed){
            // The existing fixed ZModel management models are global-only.
            // Resolve their established policy mapping against the signed
            // principal, but execute inside this SAME Kysely transaction.
            const modelName=selected.engine==='postgres'
              ?fixedPolicyWriteModel({engine:selected.engine},action,claims.role,claims)
              :null;
            if(!claims.grants.includes('global:manage')||
              !await canLocAccess(trx,'global')||
              !['update','delete'].includes(payload.p_operation)||
              (selected.engine==='postgres'&&!modelName))
              throw refusal('LOC fixed management policy denied',403);
            if(selected.engine==='postgres'){
              output=await executeManagedKyselyWrite(trx,action,{modelName});
            }else if(payload.p_table==='api.manage'){
              output={data:await applyManagedWrite(trx,
                registryRelationForEngine(selected.engine),payload)};
            }else{
              output=await executeCrossEngineManagedWrite(trx,action,{
                engine:selected.engine,namespace:selected.namespace,
                role:claims.role,claims
              });
            }
          }else{
            output=selected.engine==='postgres'
              ?await executeManagedKyselyWrite(trx,action)
              :await executeCrossEngineManagedWrite(trx,action,{
                engine:selected.engine,namespace:selected.namespace,
                role:claims.role,claims
              });
          }
          const affected=Number(output?.data?.count??0);
          // A caller may require an exact cardinality for a selected UID
          // batch. A partial match is a failed logical operation, not COMMIT.
          const expected=payload.p_expected_count;
          if(expected!==undefined&&
            (!Number.isSafeInteger(expected)||expected<0||expected!==affected))
            throw refusal('LOC transaction affected-row count mismatch',409);
          if(!Number.isSafeInteger(affected)||affected<0||
            (['update','delete'].includes(payload.p_operation)&&affected===0)||
            (['insert','upsert'].includes(payload.p_operation)&&
              affected!==payload.p_rows?.length))
            throw refusal('LOC transaction operation did not complete',409);
          outcomes.push({count:affected});
        }
        if(keywordSyncScope){
          if(!await canLocAccess(trx,'scope',keywordSyncScope))
            throw refusal('Keyword Scope management permission denied',403);
          await synchronizeKeywordLibraryInTransaction(trx,keywordSyncScope);
        }
        return outcomes;
      });
      return reply({data:{results,count:results.reduce((total,item)=>total+item.count,0)}});
    }
    if(body.kind==='managed-write'||body.kind==='managed-action'){
      if(selected.tableName)throw refusal('External mapped tables are read only',403);
      const lifecycle=body.kind==='managed-action'&&
        ['provision_scope','manage_scope_registry','delete_scope'].includes(body.name);
      // Registry route uniqueness and DDL require a stable snapshot across
      // concurrent administrator actions; the same SQL transaction still owns
      // authorization, data creation/deletion, and COMMIT or ROLLBACK.
      const transaction=selected.db.transaction();
      const row=await (lifecycle
        ?transaction.setIsolationLevel('serializable'):transaction).execute(async trx=>{
        // Resolve the existing authenticated Manage projection on this exact
        // transaction connection. No preliminary role SELECT, new RLS, or
        // second pooled client is used for the same logical operation.
        const rights=host===MCP_HOST
          ?await loadMcpLocAccess(trx,claims.email,{
            dialect:selected.dialect,engine:selected.engine,transactional:true})
          :await readLocAccess(trx,claims.email,{
            dialect:selected.dialect,engine:selected.engine,website:true,
            transactional:true});
        claims.me=rights.canWrite;
        claims.grants=rights.grants;
        if(!rights.canWrite||!rights.grants.some(grant=>
          grant==='global:manage'||grant.endsWith(':manage')))
          throw refusal('LOC management delegation required',403);
        bindLocAuthorization(trx,{role:claims.role,claims,engine:selected.engine});
        if(body.kind==='managed-action'){
          if(selected.engine!=='postgres')
            throw refusal('This LOC management action needs a portable implementation',503);
          if(body.name==='search_galaxy_private'){
            if(host!==WEB_HOST)throw refusal('Search is website-only',404);
            const preference=await trx.selectFrom('silver.loc_user')
              .select('search').where('owner_id','=',claims.sub).executeTakeFirst();
            if(preference?.search?.list!==true)
              throw refusal('Manager search preference disabled',403);
          }
          return (await executeManagedKyselyAction(trx,body,claims)).data;
        }
        const payload=body.payload||{};
        const fixed=['api.manage','silver.loc'].includes(payload.p_table);
        if(fixed&&['update','delete'].includes(payload.p_operation)){
          if(!await canLocAccess(trx,'global'))throw refusal('Global LOC management required',403);
          if(selected.engine==='postgres'){
            const modelName=fixedPolicyWriteModel({engine:selected.engine},body,
              claims.role,claims);
            if(!modelName)throw refusal('Fixed LOC management model denied',403);
            return (await executeManagedKyselyWrite(trx,body,{modelName})).data;
          }
          if(payload.p_table==='api.manage'){
            if(!Array.isArray(payload.p_filters)||!payload.p_filters.length)
              throw refusal('Unsafe unfiltered managed write',400);
            return applyManagedWrite(trx,registryRelationForEngine(selected.engine),payload);
          }
        }
        return selected.engine==='postgres'
          ?(await executeManagedKyselyWrite(trx,body)).data
          :(await executeCrossEngineManagedWrite(trx,body,{
            engine:selected.engine,namespace:selected.namespace,
            role:claims.role,claims
          })).data;
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
      const result=await selected.db.transaction().execute(async trx=>{
        const rights=await loadMcpLocAccess(trx,claims.email,{
          dialect:selected.dialect,engine:selected.engine,transactional:true});
        claims.me=rights.canWrite;claims.grants=rights.grants;
        if(!rights.canWrite)throw refusal('LOC write permission denied',403);
        return runMcp(trx);
      });
      return reply({data:result.data});
    }
    // A generic MCP read is also one logical operation: verify its active
    // Manage projection and run the scoped SELECT in the same read snapshot.
    const result=await selected.db.transaction()
      .setIsolationLevel('repeatable read').execute(async trx=>{
        const rights=await loadMcpLocAccess(trx,claims.email,{
          dialect:selected.dialect,engine:selected.engine,transactional:true});
        claims.me=rights.canWrite;claims.grants=rights.grants;
        return runMcp(trx);
      });
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
    const importCode=operationKind==='short-import'&&status>=500
      ?classifyShortImportFailure(error):'';
    const message=profileFailure?'LOC 主要資料庫連線尚未就緒':
      status>=500?'LOC native database operation unavailable'+
        (importCode?' ['+importCode+' / '+importPhase+']':''):
      String(error?.message||'LOC request denied');
    return reply({error:{message,
      ...(importCode?{code:importCode,stage:importPhase}:{}),
      ...(profileFailure?{code,stage:'db_connection'}:{})}},
      status>=400&&status<=599?status:500);
  }finally{
    releaseAbort();
    // The transaction has completed or thrown before this cleanup; every
    // rejected authorization, read, import and write releases its connection.
    try{await closeLocDatabase(selected);}
    catch(error){
      console.error('[LOC native database cleanup]',{
        code:String(error?.code||'CLOSE_FAILED').slice(0,64)
      });
    }
  }
}
