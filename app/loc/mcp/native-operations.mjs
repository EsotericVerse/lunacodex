import {NATIVE_WRITE_MAX_BYTES} from '../query/query-batch-size.mjs';
// Fixed LOC business operations inside the application backend. This is NOT a
// generic SQL endpoint: no caller-provided SQL, relation, database alias,
// connection URL, or query AST is accepted.
import {sql} from 'kysely';
import {classifyShortImportFailure} from '../import/import-failure-code.mjs';
import {verifyAccessTokenRequest,requestToResourceInput} from 'better-auth/oauth2';
import {readLocAccess,hasLocAccess} from '../permissions/loc_access.mjs';
import {fixedManageScope} from '../permissions/fixed-manage-registry.mjs';
import {loadMcpLocAccess,VerifiedLocUserInfoSchema} from './access-roles.mjs';
import {MANAGED_FILTER_SQL,managedFiltersValid} from '../../../packages/zenstack/sql-input-shape.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {authorizeDelegatedShortImport} from '../import/short-edge-authorization.mjs';
import {processShortImport,portableShortImportStore} from '../import/short-append-service.mjs';
import {executePortableMcp} from '../providers/kysely-mcp.mjs';
import {executeLocConversation} from './conversations.mjs';
import {bindLocAuthorization,canLocAccess} from '../providers/loc-authorization.mjs';
import {executeManagedKyselyWrite,executeManagedKyselyAction,
  prepareManagedKyselyWrite} from '../providers/kysely-management.mjs';
import {executeCrossEngineManagedWrite} from '../providers/sql-engine-ports.mjs';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from './native-kysely.mjs';
import {readBoundedJson,BodyTooLargeError} from './stream-json.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {registryRelationForEngine} from '../providers/live-database-target.mjs';
import {fixedPolicyWriteModel} from '../../../packages/zenstack/policy-runtime.mjs';
import {isManagedReadAction,isManagedWriteAction}
  from '../actions/managed-query-routes.mjs';

const AUTH='https://auth.lo3rwang.cc';
const JWKS=AUTH+'/api/auth/jwks';
const MCP_HOST='mcp.lo3rwang.cc';
const WEB_HOST='loc.lo3rwang.cc';
const MAX_BYTES=NATIVE_WRITE_MAX_BYTES;
const LAS_WRITE_KINDS=new Set(['mcp-sync','mcp-append','mcp-conversation','short-import']);
const bulkImportEnabled=env=>{
  const until=Date.parse(String(env?.LOC_BULK_IMPORT_UNTIL||'').trim());
  return Number.isFinite(until)&&until>Date.now();
};
const PUBLISHED_MANAGE_FIELDS=new Set([
  'email','manage_role','active','galaxy_table','anchor_table',
  'domain','directory','parent_scope_id','sort_order'
]);
// A published JS identity cannot be changed first by SQL. Role and
// routing mutations are rejected unless they exactly match the release.
function requirePublishedManageWrite(payload){
  if(payload?.p_table!=='api.manage')return;
  const filters=payload.p_filters||[];
  if(payload.p_operation!=='update'||filters.length!==1||
    filters[0]?.column!=='id'||filters[0]?.operator!=='eq')
    throw refusal('Publish the JS Manage registry before changing its rows',409);
  const fixed=fixedManageScope(filters[0].value);
  if(!fixed||!payload.p_values||typeof payload.p_values!=='object'||
     Array.isArray(payload.p_values))
    throw refusal('Unpublished JS Manage identity',409);
  for(const [field,value] of Object.entries(payload.p_values)){
    if(!PUBLISHED_MANAGE_FIELDS.has(field)||!Object.is(fixed[field],value))
      throw refusal('Manage change requires a matching published JS release',409);
  }
}

const KINDS=new Set(['mcp-sync','mcp-append','mcp-conversation',
  'short-import','managed-write','managed-transaction','managed-action']);
export function requireManagedActionGrant(body,claims){
  const args=body.args||{};
  const can=(type,scope='')=>hasLocAccess(claims,type,scope);
  const name=String(body.name||'');
  let allowed;
  if(['provision_scope','manage_scope_registry','delete_scope',
    'loc_admin_settings'].includes(name))allowed=can('global');
  else if(name==='update_group_member_name')
    allowed=can('group',String(args.p_group_id||''));
  else if(name==='save_blocks'){
    const scope=String(args.p_scope_id||'');
    const page=String(args.p_type||'').trim();
    allowed=scope==='loc'&&page!=='index'?can('global'):can('scope',scope);
  }else if(name==='move_scope_block'){
    const scope=String(args.p_scope_id||'');
    const page=String(args.p_page_name||'').trim();
    allowed=scope==='loc'?can('global')||page==='index'&&can('group','loc'):
      can('scope',scope);
  }else{
    const scope=String(name==='import_shared_keyword_class'
      ?args.p_target_scope:args.p_scope_id||'');
    allowed=can('scope',scope);
  }
  if(!allowed)throw refusal('LOC managed action Scope permission denied',403);
}
function requireManagedRelationGrant(payload,claims){
  const relation=String(payload?.p_table||'');
  if(['api.manage','silver.loc','silver.loc_anchor'].includes(relation)){
    if(!hasLocAccess(claims,'global'))
      throw refusal('LOC global management permission denied',403);
    return;
  }
  if(relation==='silver.loc_blocks')
    throw refusal('LOC Blocks are managed through the feature action',403);
  const match=/^silver\.([a-z][a-z0-9]{0,14})(?:_(?:galaxy|anchor|blocks))?$/.exec(relation);
  const scope=match?.[1]||'';
  const allowed=relation==='silver.lrunes_daily'
    ?hasLocAccess(claims,'scope','lrunes')
    :Boolean(scope)&&hasLocAccess(claims,'scope',scope);
  if(!allowed)throw refusal('LOC managed write Scope permission denied',403);
}
// api.manage / silver.loc are the only two fixed ZModel control relations a
// signed global:manage delegation may UPDATE/DELETE (packages/zenstack/policy-runtime.mjs
// ADMIN_FIXED_WRITES). No insert, no other table. The website retains its
// separate owner-only editor checks; MCP/Extension use published JavaScript
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
// The Auth service only verifies identity/credentials. LOC business grants
// are resolved from the published JavaScript registry before opening a DB
// connection. No home-made JWT, PKCE, refresh, signing or session implementation.
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
  trustedMcpBridge=false,trustedLocalAction=false,entrypoint=null
}={}){
  if(request.method!=='POST')return reply({error:{message:'Method not allowed'}},405);
  const requestHost=new URL(request.url).hostname;
  const requestPath=new URL(request.url).pathname;
  // Next trailingSlash=true serves POST route handlers on canonical slash URLs.
  // Keep exact API ownership checks while accepting both fixed spellings.
  const fixedPath=requestPath.endsWith('/')?requestPath.slice(0,-1):requestPath;
  // Only the dedicated LAS bridge may set this server-side option.
  // The dedicated LAS Next.js route maps its trusted request to the MCP
  // audience without changing the extension OAuth claims.
  const host=trustedMcpBridge&&requestHost===WEB_HOST?MCP_HOST:requestHost;
  // Keep each public route attached to its own fixed purpose. The LOC route
  // is only the temporarily enabled import path; it cannot alias the LAS
  // bridge by changing Host or dispatching another operation kind.
  if((entrypoint==='loc-native'&&
      (requestHost!==WEB_HOST||fixedPath!=='/api/loc-native'))||
    (entrypoint==='las-native'&&
      (!trustedMcpBridge||host!==MCP_HOST||fixedPath!=='/api/las-native')))
    return reply({error:{message:'Not found'}},404);
  // In the default state, reject the LOC bulk endpoint before reading a body.
  // The route is not an active parser/SQL surface until an operator enables it.
  if(entrypoint==='loc-native'&&!bulkImportEnabled(env))
    return reply({error:{message:'LOC bulk write channel is closed'}},404);
  if(host!==MCP_HOST&&host!==WEB_HOST)
    return reply({error:{message:'Not found'}},404);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
    return reply({error:{message:'JSON body required'}},415);
  if(Number(request.headers.get('content-length')||0)>MAX_BYTES)
    return reply({error:{message:'Payload too large'}},413);
  let operationKind='',importPhase='request';
  let shortImportActor=null;
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
    if(entrypoint==='loc-native'&&body.kind!=='short-import')
      throw refusal('LOC route accepts temporary bulk writes only',404);
    if(entrypoint==='las-native'&&!LAS_WRITE_KINDS.has(body.kind))
      throw refusal('LAS bridge accepts fixed LOC write operations only',404);
    if(body.kind==='managed-action'){
      const name=String(body.name||'');
      if(isManagedReadAction(name,body.args))
        throw refusal('LOC reads must use their feature-owned Server Action',404);
      if(!isManagedWriteAction(name,body.args))
        throw refusal('Unknown LOC managed write action',404);
    }
    operationKind=body.kind;
    if(operationKind==='short-import')importPhase='identity';
    // Bulk import is opt-in on every host. The LOC HTTP route and the LAS
    // bridge cannot accidentally leave this fast write path enabled by default.
    if(body.kind==='short-import'&&!bulkImportEnabled(env))
      throw refusal('LOC bulk write channel is closed',404);
    if(host===WEB_HOST&&!trustedLocalAction){
      if(body.kind!=='short-import')
        throw refusal('LOC native endpoint is reserved for temporary bulk writes',404);
    }
    // LAS keeps only its named synchronization/conversation write operations.
    // The website's generic managed-write dispatcher is process-local and is
    // never exposed as an HTTP API on the LAS bridge.
    if(host===MCP_HOST&&!LAS_WRITE_KINDS.has(body.kind))
      throw refusal('LAS bridge accepts fixed LOC write operations only',404);
    // The website's HTTP channel is a temporarily enabled bulk-write path.
    // Ordinary saves are in-process Server Actions; feature reads stay local.
    // The LOC administrator creates and removes SQL Scopes only through
    // the verified Web Session. Do not expose DDL through MCP OAuth delegates.
    if(body.kind==='managed-action'&&
      ['provision_scope','manage_scope_registry','delete_scope'].includes(body.name)&&
      host!==WEB_HOST)throw refusal('LOC Scope lifecycle is website-only',403);
    if(body.kind==='mcp-conversation'&&
      (host!==MCP_HOST||!['record','record_ordered'].includes(body.action)))
      throw refusal('LOC native channel accepts conversation writes only',404);
    // The verified signed claim, not the HTTP body, selects the connection.
    const claims=await signedClaims(request,fetchImpl,{trustedMcpBridge:host===MCP_HOST});
    // LOC Auth verifies identity; only published JavaScript grants may
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
    if(body.kind==='managed-write')requirePublishedManageWrite(body.payload);
    if(body.kind==='managed-transaction'){
      // Validate the complete input envelope before opening a database
      // connection, and never begin a transaction for a malformed batch.
      if(body.keywordSyncScope)
        throw refusal('Retired Keyword sync requested; reload LOC',409);
      if(body.scopeid!==''||!Array.isArray(body.operations)||!body.operations.length||
        body.operations.some(item=>!item||typeof item!=='object'||
          Array.isArray(item)||
          !['insert','update','delete','upsert','update_batch','append_media_link'].includes(item.p_operation)||
          typeof item.p_table!=='string'))
        throw refusal('Invalid LOC management transaction',400);
      for(const item of body.operations){
        requirePublishedManageWrite(item);
        const expected=item.p_expected_count;
        if(expected!==undefined&&(!Number.isSafeInteger(expected)||expected<0))
          throw refusal('LOC transaction affected-row count mismatch',409);
      }
    }
    // Business grants come from the published JS snapshot, not SQL.
    // Fail closed before opening any database connection.
    if(operationKind==='short-import')importPhase='permission';
    const rights=host===MCP_HOST
      ?await loadMcpLocAccess(null,claims.email)
      :await readLocAccess(null,claims.email,{website:true});
    claims.me=rights.canWrite;
    claims.grants=rights.grants;
    if(writeKinds.has(body.kind)&&!rights.canWrite)
      throw refusal('LOC write permission denied',403);
    if(body.kind==='managed-action')
      requireManagedActionGrant(body,claims);
    if(body.kind==='managed-write')
      requireManagedRelationGrant(body.payload,claims);
    if(body.kind==='managed-transaction')
      for(const item of body.operations)requireManagedRelationGrant(item,claims);
    if(body.kind==='short-import'){
      // Check the exact signed Scope grant and the complete import envelope
      // before opening any database connection.
      importPhase='delegation';
      shortImportActor=authorizeDelegatedShortImport(body,claims);
    }
    // Authorization is resolved from LOC's published JS before DB connection.
    // External user-selected connections are READ ONLY, whether they map an
    // existing table or expose the ordinary Scope schema. This includes the
    // extension import path and MCP append/sync. OAuth never changes this.
    const writesToSelectedDatabase=['short-import','mcp-sync','mcp-append']
      .includes(body.kind);
    const primaryId=DATABASE_ACCESS_LIST.find(item=>item.selected===true)?.target_id;
    if(writesToSelectedDatabase&&claims.db_target&&claims.db_target!==primaryId)
      throw refusal('External database connections are read only',403);
    // Management actions use LOC's control database; selected external
    // connections are only for permitted Scope data operations.
    const control=['managed-write','managed-transaction','managed-action']
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
    // No connection/transaction is held while validating ZModel and input
    // rows. Database-state-dependent Scope checks stay inside Kysely trx.
    const preparedWrites=selected.engine==='postgres'
      ?body.kind==='managed-transaction'
        ?body.operations.map(payload=>prepareManagedKyselyWrite({kind:'managed-write',payload}))
        :body.kind==='managed-write'?prepareManagedKyselyWrite(body):null
      :null;
    // Galaxy reads stay in their feature Server Actions. LAS only maps write
    // envelopes and forwards a verified OAuth bearer to fixed write operations.
    if(body.kind==='mcp-conversation'){
      const result=await selected.db.transaction().execute(async trx=>{
        if(writeKinds.has(body.kind)&&!claims.me)
          throw refusal('LOC write permission denied',403);
        return executeLocConversation(trx,body,claims);
      });
      return reply({data:result});
    }
    if(body.kind==='short-import'){
      if(selected.tableName)throw refusal('External mapped tables are read only',403);
      importPhase='validation';
      const receipt=await processShortImport(body.batch,shortImportActor,{
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
      const results=await selected.db.transaction().execute(async trx=>{
        const verifiedRights={canWrite:claims.me,grants:claims.grants};
        if(!verifiedRights.canWrite||!claims.grants.some(grant=>
          grant==='global:manage'||grant.endsWith(':manage')))
          throw refusal('LOC management delegation required',403);
        bindLocAuthorization(trx,{role:claims.role,claims,engine:selected.engine});
        const outcomes=[];
        for(const [index,payload] of operations.entries()){
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
              output=await executeManagedKyselyWrite(trx,action,{
                modelName,prepared:preparedWrites?.[index]});
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
              ?await executeManagedKyselyWrite(trx,action,{
                prepared:preparedWrites?.[index]})
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
        const rights={canWrite:claims.me,grants:claims.grants};
        if(!rights.canWrite||!rights.grants.some(grant=>
          grant==='global:manage'||grant.endsWith(':manage')))
          throw refusal('LOC management delegation required',403);
        bindLocAuthorization(trx,{role:claims.role,claims,engine:selected.engine});
        if(body.kind==='managed-action'){
          if(selected.engine!=='postgres')
            throw refusal('This LOC management action needs a portable implementation',503);
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
            return (await executeManagedKyselyWrite(trx,body,{
              modelName,prepared:preparedWrites})).data;
          }
          if(payload.p_table==='api.manage'){
            if(!Array.isArray(payload.p_filters)||!payload.p_filters.length)
              throw refusal('Unsafe unfiltered managed write',400);
            return applyManagedWrite(trx,registryRelationForEngine(selected.engine),payload);
          }
        }
        return selected.engine==='postgres'
          ?(await executeManagedKyselyWrite(trx,body,{
            prepared:preparedWrites})).data
          :(await executeCrossEngineManagedWrite(trx,body,{
            engine:selected.engine,namespace:selected.namespace,
            role:claims.role,claims
          })).data;
      });
      return reply({data:row});
    }
    const runMcp=db=>executePortableMcp(db,body,claims,{
      engine:selected.engine,namespace:selected.namespace});
    // Reuse the JavaScript grants already resolved for this request.
    // Do not fetch the registry again inside each MCP business operation.
    if(body.kind==='mcp-sync'||body.kind==='mcp-append'){
      if(selected.tableName)
        throw refusal('LOC MCP control database is unavailable for writing',503);
      const result=await selected.db.transaction().execute(async trx=>{
        if(!claims.me)throw refusal('LOC write permission denied',403);
        return runMcp(trx);
      });
      return reply({data:result.data});
    }
    throw refusal('LOC native channel accepts writes only',404);
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
