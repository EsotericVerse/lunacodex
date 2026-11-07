import { sql } from "npm:kysely@0.29.8";
import {ZenStackClient} from "npm:@zenstackhq/orm@3.10.1";
import {PolicyPlugin} from "npm:@zenstackhq/plugin-policy@3.10.1";
import {scopedZModelSchema} from "../../../zenstack/scoped-schema.mjs";
import {executeNativeRead} from "../../../zenstack/native-query.mjs";
import {withFixedPolicyRead,fixedPolicyReadModel,withFixedPolicyWrite,fixedPolicyWriteModel} from "../../../zenstack/policy-runtime.mjs";
import {jwtVerify,createRemoteJWKSet} from "npm:jose@5.9.6";
import {processShortImport,postgresShortImportStore} from "../../../app/loc/import/short-append-service.mjs";
import {authorizeDelegatedShortImport} from "../../../app/loc/import/short-edge-authorization.mjs";
import {delegationAudience,verifyDelegationBoundary,canManageDelegation} from "../../../app/loc/auth/delegation-contract.mjs";
import {databaseForTarget,resolveConnectionProfile,trustedDialectForDatabase} from "../providers/kysely-database-drivers.ts";
import {readVaultConnection} from "./database-connections.ts";
import { executeKyselyQuery, isKyselyClientError } from "../../../app/loc/providers/kysely-runtime.mjs";
import {executePortableMcp} from "../../../app/loc/providers/kysely-mcp.mjs";
import {executeManagedKyselyWrite,executeManagedKyselyAction} from "../../../app/loc/providers/kysely-management.mjs";
import {saveBlocksKysely} from "../../../app/loc/providers/kysely-blocks.mjs";
import {executeKyselyAnchor,executePortableKyselyAnchor} from "../../../app/loc/providers/kysely-anchor.mjs";
import {executeKyselyAnalytics,executePortableKyselyAnalytics} from "../../../app/loc/providers/kysely-analytics.mjs";
import {executeKyselyPublicAction} from "../../../app/loc/providers/kysely-public.mjs";
import {executeKyselyScopeAdmin} from "../../../app/loc/providers/kysely-scope-admin.mjs";
import {validatePortableScopeSchema} from "../../../app/loc/providers/kysely-schema.mjs";
import { selectedDatabaseTarget } from "../../../app/loc/providers/selected-database-target.mjs";
import {resolveSqlExecutionPort,assertCrossEnginePublicRead,authorizeCrossEngineQuery,executeCrossEngineManagedWrite} from "../../../app/loc/providers/sql-engine-ports.mjs";
import {resolveDatabaseRouting} from "../../../app/loc/providers/routing-config.mjs";
import {databaseAccessTargets} from "../../../app/loc/providers/access.js";
import {isTextSearchQuery,checkSearchQos} from "../../../app/loc/providers/search-qos.mjs";
import {withIndexedCandidates,federatedIndexedCandidates,writeSearchIndexDocuments,indexDocumentsFromWrite,isSearchIndexConfigured,searchIndexDatabaseId} from "../../../app/loc/providers/search-index-service.mjs";
import {federatedDatasetsFor,indexTargetForScope,federatedScopeFromQuery,isFederatedTextSearch,isDatasetQualifiedArticleRead,publicGalaxyGate,mergeFederatedGalaxyRows} from "../../../app/loc/providers/federated-galaxy-search.mjs";
import {bindLocAuthorization,canManageLoc} from "../../../app/loc/providers/loc-authorization.mjs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")||"";
// The Authority signs RS256 LOC delegations; the Gateway fetches only its
// public signing keys. No Clerk/Neon/Supabase Auth and no shared signing secret.
// An alternate deployment may pin its own trusted HTTPS Authority origin.
const locAuthorityOrigin=(()=>{
  const input=Deno.env.get("LOC_AUTHORITY_ORIGIN")||"https://auth.lo3rwang.cc";
  const url=new URL(input);
  if(url.protocol!=="https:"||url.username||url.password||url.search||
     url.hash||!["","/"].includes(url.pathname))
    throw new Error("Invalid LOC Authority origin");
  return url.origin;
})();
const locDelegationJwks=createRemoteJWKSet(
  new URL("/.well-known/jwks.json",locAuthorityOrigin),
  {timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:300000}
);
async function verifyLocDelegation(token:string,body:Record<string,unknown>){
  const {payload}=await jwtVerify(token,locDelegationJwks,{
    issuer:"loc",audience:delegationAudience(body),algorithms:["RS256"]
  });
  return verifyDelegationBoundary(payload,body,{
    notBefore:Deno.env.get("LOC_DELEGATION_NOT_BEFORE")||"0",
    revokedSids:Deno.env.get("LOC_DELEGATION_REVOKED_SIDS")||""
  });
}

// The deployed function and browser use the same source-controlled routing contract.
const routing = resolveDatabaseRouting();
// Cross-engine publicly readable tables are centrally enforced by sql-engine-ports.mjs.

// The LOC control database is a trusted server-side connection alias.
// Existing deployments keep their legacy default. Standalone LOC SQL nodes
// can use any provisioned PostgreSQL/MySQL/MSSQL control profile without
// a Supabase project URL, Data API, or Vault.
const controlTarget=(()=>{
  const alias=String(Deno.env.get("LOC_CONTROL_DB_ALIAS")||"");
  if(!alias)return {provider:"supabase",engine:"postgres",
    connection_alias:"supabase_current",connection_mode:"pooler"};
  return selectedDatabaseTarget([{
    provider:"custom",engine:Deno.env.get("LOC_CONTROL_DB_ENGINE")||"postgres",
    connection_alias:alias,connection_mode:"direct",selected:true
  }]);
})();

function isControlTarget(target:Record<string,unknown>){
  if(target.engine!==controlTarget.engine||
     target.connection_alias!==controlTarget.connection_alias||
     target.provider!==controlTarget.provider)return false;
  if(target.provider!=="supabase")return true;
  const link=String(target.project_url||"").replace(/\/$/,"");
  return !link||Boolean(supabaseUrl)&&link===supabaseUrl.replace(/\/$/,"");
}


const profileCache=new Map<string,{until:number,profile:any}>();
async function profileForTarget(target:Record<string,unknown>){
  if(isControlTarget(target))return resolveConnectionProfile(controlTarget);
  // Vault is a compatibility path for the original Supabase control DB only.
  // Independent SQL deployments use trusted LOC_DB_CONNECTIONS_JSON aliases
  // and must not query provider-specific metadata tables.
  if(controlTarget.provider!=="supabase")return resolveConnectionProfile(target);
  const key=String(target.connection_alias||'')+':'+String(target.project_url||'');
  const cached=profileCache.get(key);
  if(cached&&Date.now()<cached.until)return cached.profile;
  const control=await databaseForTarget(controlTarget);
  const profile=await readVaultConnection(control,target)||
    resolveConnectionProfile(target);
  profileCache.set(key,{until:Date.now()+30_000,profile});
  return profile;
}
async function checkAdminRole(claims:Record<string,unknown>){
  if(!canManageDelegation(claims,"global"))
    throw Object.assign(new Error("Administrator delegation required"),{httpStatus:403});
  return null;
}
// Database access metadata is loaded once from the deployment JS file.
// This must never SELECT api.manage.database (or LOC) on requests.
function databaseListForControl(_control?:any):Record<string,any>[] {
  return databaseAccessTargets();
}
async function liveConfiguredTarget():Promise<Record<string,unknown>> {
  const selected=databaseAccessTargets().find(item=>item.target_id===routing.primaryId);
  if(!selected){
    // Preserve opt-in portable SQL adapters; connections still require the
    // server-side alias in LOC_DB_CONNECTIONS_JSON, never a public password.
    if(routing.provider==='custom')return {
      provider:'custom',engine:routing.engine,
      connection_alias:routing.connectionAlias,connection_mode:'direct'
    };
    throw new Error('Configured database target is missing from access.js');
  }
  return isControlTarget(selected)
    ?controlTarget:selectedDatabaseTarget([{...selected,selected:true}]);
}

// One PostgreSQL session bridge for both ordinary SQL and managed MCP.
// PostgreSQL may apply its own RLS; other engines never depend on it.
async function bindPostgresSession(trx:any,role:string,claims:Record<string,unknown>,provider="supabase"){
  if(role==="authenticated")await sql`set local role authenticated`.execute(trx);
  else if(provider==="neon")await sql`set local role anonymous`.execute(trx);
  else await sql`set local role anon`.execute(trx);
  await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
  await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
  await sql`select set_config('request.jwt.claim.role',${role},true)`.execute(trx);
}

async function executeRequest(trx: any, target: Record<string,any>, role: string,
  claims: Record<string, unknown>, body: Record<string, unknown>,
  {modelName="",ormClient=null,nativeScopeModel=""}:{modelName?:string,ormClient?:any,nativeScopeModel?:string}={}) {
  const executionPort=resolveSqlExecutionPort(target);
  bindLocAuthorization(trx,{role,claims});
  if(target.provider==="custom"||executionPort.session!=="postgres-rls"){
    // Fixed public PostgreSQL models use the same ZenStack PolicyPlugin and
    // physical schema regardless of hosting vendor. This modelName is set
    // only inside the trusted gateway, never accepted from the HTTP body.
    if(executionPort.engine==="postgres"&&modelName&&
       body.kind==="query"&&body.operation==="select"){
      // Keep the existing policy-wrapped connection; use native ORM if exact.
      const native=ormClient&&await executeNativeRead(ormClient,body,modelName);
      if(native)return native;
      return await executeKyselyQuery(trx,body,{modelName});
    }
    // Cross-engine Scope queries use the signed LOC ACL instead of RLS.
    if(body.kind==="managed-write"){
      if(role!=="authenticated")
        throw Object.assign(new Error("Management requires verified LOC delegation"),{httpStatus:403});
      return await executeCrossEngineManagedWrite(trx,body,{role,claims,
        engine:executionPort.engine,namespace:target.schema_name});
    }
    if(body.kind==="managed-action"&&body.name==="save_blocks"){
      if(role!=="authenticated")
        throw Object.assign(new Error("Verified editor required"),{httpStatus:403});
      const args=body.args as Record<string,unknown>||{};
      const scope=String(args.p_scope_id||"").trim().toLowerCase();
      const type=String(args.p_type||"").trim();
      const level=scope==="loc"&&type!=="index"?"global":"scope";
      if(!await canManageLoc(trx,level,scope))
        throw Object.assign(new Error("Block write permission denied"),{httpStatus:403});
      return {data:await saveBlocksKysely(trx,args,{
        engine:executionPort.engine,namespace:String(target.schema_name||
          (executionPort.engine==="mssql"?"dbo":"silver"))
      }),count:null};
    }
    // A standalone PostgreSQL control database supports the original LOC
    // management actions without a provider identity or new database RPC.
    if(body.kind==="managed-action"&&executionPort.engine==="postgres"){
      if(role!=="authenticated")
        throw Object.assign(new Error("Verified LOC management delegation required"),{httpStatus:403});
      const name=String(body.name||"");
      return ["manage_scope_registry","delete_scope","provision_scope"].includes(name)
        ?await executeKyselyScopeAdmin(trx,body)
        :await executeManagedKyselyAction(trx,body,claims);
    }
    if(body.kind==="anchor")return await executePortableKyselyAnchor(trx,body,{
      role,engine:executionPort.engine,namespace:target.schema_name
    });
    if(body.kind==="analytics")return await executePortableKyselyAnalytics(trx,body,{
      role,engine:executionPort.engine,namespace:target.schema_name
    });
    if(body.kind==="public-action")return await executeKyselyPublicAction(trx,body,{
      engine:executionPort.engine,namespace:String(target.schema_name||
        (executionPort.engine==="mssql"?"dbo":"silver"))
    });
    const access=await authorizeCrossEngineQuery(trx,body,{role,claims});
    // A signed session is not itself permission to see unpublished Galaxy
    // rows; retain the cross-database public Search visibility gate.
    const publicOnly=publicGalaxyGate(body,role,claims)||access?.publicOnly===true;
    if(ormClient&&nativeScopeModel&&!publicOnly){
      const native=await executeNativeRead(ormClient,body,nativeScopeModel);
      if(native)return native;
    }
    return await executeKyselyQuery(trx,body,{dialect:executionPort.engine,
      // PostgreSQL keeps the request's real api/silver schema. Other SQL
      // engines use the configured flat database/dbo namespace.
      namespace:executionPort.engine==='postgres'&&!target.schema_name
        ?undefined:String(target.schema_name||(
          executionPort.engine==='mssql'?'dbo':'public')),
      publicOnly,
      // Within ZenStack $qb use the mapped logical model; raw physical
      // relations may be interpreted under the wrong default schema.
      modelName:nativeScopeModel||''});
  }
  await bindPostgresSession(trx,role,claims,String(target.provider||"supabase"));
  if(body.kind==="query"){
    // A database RLS policy may be more permissive than the delegated Scope.
    // Require the already signed LOC grant for every non-public SQL mutation,
    // then let PostgreSQL apply its own independent RLS/DB privileges.
    if(body.operation!=="select"&&
       (body.schema==="api"&&body.table==="manage"||
        body.schema==="silver"&&body.table==="loc")){
      // Both generic CRUD and managed-write require the identical signed
      // global LOC grant. Do not leave direct api.manage writes to DB RLS alone.
      if(!await canManageLoc(trx,"global"))
        throw Object.assign(new Error("Global LOC management permission required"),
          {httpStatus:403});
    }else if(body.operation!=="select"&&body.schema==="silver")
      await authorizeCrossEngineQuery(trx,body,{role,claims});
    // PostgreSQL must stop work even when browser aborts its 25s timeout.
    if(isTextSearchQuery(body))
      await sql`set local statement_timeout = '8000ms'`.execute(trx);
    // Public Search stays independently protected even when PostgreSQL
    // has no RLS. Native ORM is used only if those filters are unnecessary.
    const publicOnly=publicGalaxyGate(body,role,claims);
    if(!publicOnly&&ormClient&&body.operation==="select"&&(nativeScopeModel||modelName)){
      const native=await executeNativeRead(ormClient,body,nativeScopeModel||modelName);
      if(native)return native;
    }
    return await executeKyselyQuery(trx,body,{
      modelName:nativeScopeModel||modelName,publicOnly
    });
  }
  if(body.kind==="anchor")return await executeKyselyAnchor(trx,body,{role,claims});
  if(body.kind==="analytics")return await executeKyselyAnalytics(trx,body,{role});
  if(body.kind==="public-action")return await executeKyselyPublicAction(trx,body);
  if(body.kind==="managed-write"||body.kind==="managed-action"){
    if(role!=="authenticated")throw Object.assign(new Error("Management requires a verified session"),{httpStatus:403});
    return body.kind==="managed-write"
      ?await executeManagedKyselyWrite(trx,body,{modelName})
      :["manage_scope_registry","delete_scope","provision_scope"].includes(String(body.name))
        ?await executeKyselyScopeAdmin(trx,body)
        :await executeManagedKyselyAction(trx,body,claims);
  }
  throw Object.assign(new Error("Unsupported SQL operation: legacy RPC dispatch has been retired"),{httpStatus:400});
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

Deno.serve(async (request) => {
  // Container liveness is intentionally database-free and does not mint grants.
  // The public Worker exposes only /v1/sql; /health stays on the internal port.
  if (request.method === "GET" && new URL(request.url).pathname === "/health")
    return new Response(null, {status: 204, headers: {"cache-control": "no-store"}});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_048_576) return json({ error: { message: "Request body is too large" } }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1_048_576) return json({ error: { message: "Request body is too large" } }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: { message: "Invalid JSON body" } }, 400);
  } catch {
    return json({ error: { message: "Invalid JSON body" } }, 400);
  }
  const requestedTarget = body.target === undefined ? "configured" : body.target;
  if (!["configured", "supabase", "neon", "backup"].includes(String(requestedTarget))) {
    return json({ error: { message: "Unsupported database target" } }, 400);
  }

  let role = "anon";
  let claims: Record<string, unknown> = {role};
  let verifiedMcp=false;
  const authorization=request.headers.get("authorization")||"";
  if(authorization){
    const match=authorization.match(/^Bearer\s+(.+)$/i);
    if(!match)return json({error:{message:"Invalid authorization header"}},401);
    try{
      const delegation=await verifyLocDelegation(match[1],body);
      claims=delegation.claims;
      verifiedMcp=delegation.verifiedMcp;
      role="authenticated";
    }catch{
      return json({error:{message:"Invalid or unauthorized LOC delegation"}},401);
    }
  }

  // Explicit database-target selection is never a public capability.
  // Ordinary visitors use the server-selected configured target only.
  if(requestedTarget!=="configured"){
    if(role!=="authenticated")
      return json({error:{message:"Administrator permission required"}},403);
    try{await checkAdminRole(claims);}
    catch{return json({error:{message:"Administrator permission required"}},403);}
  }

  // LOC's independent OAuth/Authority gateway must first mint a signed SQL
  // delegation. This internal entry cannot accept a browser OAuth token,
  // a user-provided actor, or an arbitrary SQL table/target.
  if(body.kind==="short-import"){
    try{
      if(requestedTarget!=="configured")
        return json({error:{message:"Managed short import uses the LOC control database only"}},403);
      const actor=authorizeDelegatedShortImport(body,claims);
      // Only the two managed Galaxy tables are reachable. Use the trusted
      // database connection/DBM here, not a new INSERT RLS policy or RPC.
      // PostgreSQL has no authenticated INSERT policy on these tables;
      // signed Scope authorization is checked above before any DB request.
      const db=await databaseForTarget(controlTarget);
      const response=await processShortImport(body.batch,actor,{
        store:postgresShortImportStore(db,sql)
      });
      // The short-import transaction has committed. One bounded UID query
      // captures the actual stored text, including append markers; no
      // guessed UID or client-provided partial document enters the index.
      if(isSearchIndexConfigured()&&response?.accepted===true){
        try{
          const indexedTarget=indexTargetForScope(
            Deno.env.get("LOC_SEARCH_DATASETS_JSON")||"",actor.scopeid,controlTarget);
          const sourceId=indexedTarget?searchIndexDatabaseId(indexedTarget):null;
          const ids=[...new Set((response.articles||[])
            .filter(item=>item?.appended>0)
            .map(item=>String(item.uid||''))
            .filter(uid=>/^[A-Za-z0-9]{8}$/.test(uid)))];
          if(ids.length&&sourceId){
            const articles=await db.selectFrom('silver.'+actor.scopeid+'_galaxy')
              .select(['uid','content']).where('uid','in',ids).execute();
            await writeSearchIndexDocuments(articles.map(row=>({
              scopeId:actor.scopeid,dbId:sourceId,entityType:'galaxy',
              uid:row.uid,content:row.content,operation:'upsert'
            })));
          }
        }catch(error){console.warn('[loc-search-index] short import index update failed',String(error));}
      }
      return json(response);
    }catch(error){
      const status=Number((error as {httpStatus?:number})?.httpStatus)||500;
      if(status>=500)console.error("[LOC short-import] delegated write failed",error);
      return json({error:{message:status>=500?"Short import unavailable":
        String(error instanceof Error?error.message:"Invalid short import payload")}},
        status>=400&&status<=599?status:500);
    }
  }

  const textSearch=isTextSearchQuery(body);
  if(textSearch){
    // Uses the LOC delegation subject when verified; otherwise client
    // IP. Each warm isolate bounds abuse without adding database writes.
    const source=role==="authenticated"&&typeof claims.sub==="string"
      ?"loc:"+claims.sub
      :"ip:"+(request.headers.get("cf-connecting-ip")||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||
        "unknown");
    const verdict=checkSearchQos(source);
    if(!verdict.allowed){
      const seconds=Math.max(1,Math.ceil(verdict.retryAfterMs/1000));
      return json({error:{message:verdict.blocked
        ?"搜尋過於頻繁，已暫時限制，請稍後再試"
        :"搜尋操作太快，請稍後重試",code:"SEARCH_RATE_LIMIT",
        retry_after:seconds}},429,{"retry-after":String(seconds)});
    }
  }
  let resolvingTarget = false;
  try {
    if(body.kind==="index-snapshot"){
      if(requestedTarget!=="configured")
        return json({error:{message:"Index snapshot requires configured SQL route"}},403);
      // Trusted, read-only index backfill. This endpoint is not exposed by
      // the browser client: both a scope-management LOC delegation and the
      // separate index-service secret are required. It never mutates SQL.
      const scopeId=String(body.scopeId||"");
      const databaseId=String(body.databaseId||"");
      const expectedSecret=String(Deno.env.get("LOC_SEARCH_INDEX_SECRET")||"");
      const suppliedSecret=String(request.headers.get("x-loc-index-secret")||"");
      const encode=new TextEncoder();
      const a=encode.encode(expectedSecret),b=encode.encode(suppliedSecret);
      let diff=a.length^b.length;
      for(let i=0;i<Math.max(a.length,b.length);i++)
        diff|=(a[i]||0)^(b[i]||0);
      if(role!=="authenticated"||expectedSecret.length<32||diff!==0||
         !/^[a-z][a-z0-9]{0,14}$/.test(scopeId)||
         !/^[a-z][a-z0-9_-]{0,63}$/.test(databaseId)||
         !canManageDelegation(claims,"scope",scopeId))
        return json({error:{message:"Verified LOC index backfill permission required"}},403);
      const datasets=federatedDatasetsFor(
        Deno.env.get("LOC_SEARCH_DATASETS_JSON")||"",scopeId);
      const configured=await liveConfiguredTarget();
      const selected=datasets.find(item=>item.databaseId===databaseId);
      const source=selected?.target||
        (datasets.length===0&&databaseId===searchIndexDatabaseId(configured)
          ?configured:null);
      if(!source)return json({error:{message:"Index source is not registered for this Scope"}},409);
      const offset=Number(body.offset||0),limit=Number(body.limit||50);
      const head=body.head===true;
      if(!Number.isSafeInteger(offset)||offset<0||offset>10_000_000||
         !Number.isSafeInteger(limit)||limit<1||limit>50)
        return json({error:{message:"Invalid bounded index snapshot page"}},400);
      const db=isControlTarget(source)
        ?await databaseForTarget(controlTarget)
        :await databaseForTarget(source,{profileLookup:profileForTarget});
      const executionPort=resolveSqlExecutionPort(source);
      const queryBody={
        kind:"query",schema:"silver",table:scopeId+"_galaxy",operation:"select",
        columns:head?["uid"]:["uid","content"],
        filters:[],or:[],orders:[{column:"createtime",ascending:true}],
        head,count:head?"exact":null,limit,offset
      };
      // DBM connection is trusted here. Reading the complete index dataset
      // must not depend on vendor RLS session impersonation or public flags.
      // No UID ordering: duplicates/coverage are checked by the builder.
      const result=await db.transaction().execute(trx=>executeKyselyQuery(trx,
        queryBody,{dialect:executionPort.engine,namespace:
          executionPort.engine==="postgres"&&!source.schema_name
            ?undefined:String(source.schema_name||(
              executionPort.engine==="mssql"?"dbo":"public"))}));
      return json(result);
    }
    if(["mcp-read","mcp-search","mcp-sync","mcp-append"].includes(String(body.kind))){
      // One LOC-signed Kysely executor for all SQL dialects. The Gateway has
      // already verified the JWT audience, Scope and action. No provider
      // Data API, PostgreSQL-only function, search RPC, or RLS impersonation.
      if(!verifiedMcp||role!=="authenticated")
        return json({error:{message:"Verified MCP Scope permission required"}},403);
      if(requestedTarget!=="configured")
        return json({error:{message:"MCP requires the configured SQL target"}},403);
      const mcpTarget=await liveConfiguredTarget();
      const db=await databaseForTarget(mcpTarget,{profileLookup:profileForTarget});
      const result=await db.transaction().execute(trx=>executePortableMcp(trx,body,claims,{
        engine:String(mcpTarget.engine),provider:String(mcpTarget.provider),
        namespace:String(mcpTarget.schema_name||"")
      }));
      // MCP append is incremental. Do not reload a whole conversation solely
      // to update FlexSearch; the matching SQL transaction already committed.
      if(result?.data?.duplicate!==true&&isSearchIndexConfigured()){
        const scopeId=String(body.scopeid||'');
        const indexedTarget=indexTargetForScope(
          Deno.env.get("LOC_SEARCH_DATASETS_JSON")||"",scopeId,mcpTarget);
        const dbId=indexedTarget?searchIndexDatabaseId(indexedTarget):null;
        const row=body.kind==='mcp-sync'?body.row:null;
        const doc=body.kind==='mcp-sync'&&row
          ?{uid:row.uid,content:row.content,operation:'upsert'}
          :body.kind==='mcp-append'
            ?{uid:body.uid,content:body.content,operation:'append'}:null;
        if(dbId&&doc){
          const ok=await writeSearchIndexDocuments([{...doc,
            scopeId,dbId,entityType:'galaxy'}]);
          if(!ok)console.warn('[loc-search-index] MCP index update incomplete');
        }
      }
      return json(result);
    }
    if(body.kind==="mcp-update-pr")
      return json({error:{message:"請至github頁面找尋PR相關資料！不開放搜尋PR!"}},410);
    if(body.kind==="managed-action"&&body.name==="check_backup_readiness"){
      if(requestedTarget!=="configured")return json({error:{message:"Invalid health target"}},400);
      if(role!=="authenticated")return json({error:{message:"Administrator permission required"}},403);
      const control=await checkAdminRole(claims);
      const candidates=(await databaseListForControl(control))
        .filter(item=>item.backup_selected===true).slice(0,2);
      if(!candidates.length)return json({data:{configured:false,online:false,schema:false}});
      if(candidates.length!==1)return json({data:{configured:true,online:false,schema:false}});
      try{
        const target=selectedDatabaseTarget([{...candidates[0],selected:true}]);
        const backup=await databaseForTarget(target,{profileLookup:profileForTarget});
        await sql`select 1 as ready`.execute(backup);
        const tables=await backup.introspection.getTables();
        const required:Record<string,string[]>={
          manage:["id","manage_role","parent_scope_id"],
          loc:["id","theme"],
          loc_blocks:["uid","page_name","block_order","block_text"]
        };
        const valid=Object.entries(required).every(([name,columns])=>{
          const table=tables.find(table=>table.name===name&&
            (table.schema==="silver"||(!table.schema&&target.engine!=="postgres")));
          return Boolean(table&&columns.every(column=>table.columns.some(field=>field.name===column)));
        });
        return json({data:{configured:true,online:true,schema:valid}});
      }catch(error){
        console.warn("[loc-kysely] Admin-only backup readiness check failed",error);
        return json({data:{configured:true,online:false,schema:false}});
      }
    }
    // Status is a pure repository-config lookup, never a SELECT.
    if(body.kind==="status"&&body.name==="active_public_target"){
      if(requestedTarget!=="configured")return json({error:{message:"Invalid status target"}},400);
      if(role!=="authenticated")return json({error:{message:"Administrator permission required"}},403);
      try{await checkAdminRole(claims);}
      catch{return json({error:{message:"Administrator permission required"}},403);}
      return json({data:{
        provider:routing.provider,
        primary_id:routing.primaryId,
        primary_control:routing.primaryControl,
        backup_id:routing.backupId,
        backup_provider:routing.backupProvider,
        mode:routing.mode
      }});
    }
    // LOC management action, not a database RPC.
    if(body.kind==="managed-action"&&body.name==="connect_database_target"){
      if(role!=="authenticated")return json({error:{message:"Administrator permission required"}},403);
      try{await checkAdminRole(claims);}
      catch{return json({error:{message:"Administrator permission required"}},403);}
      return json({error:{message:"Database targets live in access.js; update source and redeploy"}},409);
    }

    // LOC registry, user settings and public presentation are control-plane
    // actions. A user-managed SQL target only needs its own data tables.
    const controlManage=new Set(["manage","read_source_catalog","save_scope_sources","read_group_members",
      "update_group_member_name","update_group_default_article_class",
      "loc_admin_settings","is_current_email_blocklisted",
      "read_scope_registry_admin","manage_scope_registry",
      "provision_scope","delete_scope"]);
    if(requestedTarget==="configured"&&
      body.kind==="managed-action"&&controlManage.has(String(body.name))){
      const control=await databaseForTarget(controlTarget);
      const result=await control.transaction().execute(trx=>
        executeRequest(trx,controlTarget,role,claims,body));
      return json(result);
    }
    let target=controlTarget as Record<string,any>;
    if(requestedTarget==="configured")
      target=await liveConfiguredTarget() as Record<string,any>;
    if(requestedTarget==="neon"){
      if(routing.backupId!=="neon-current"||routing.backupProvider!=="neon")
        return json({error:{message:"Neon target is not enabled by repository routing"}},403);
      target={provider:"neon",engine:"postgres",connection_alias:"neon_current",connection_mode:"direct"};
    }
    if(requestedTarget==="backup"){
      if(!routing.backupId)return json({error:{message:"Backup is disabled by repository routing"}},503);
      if(body.kind!=="query"||body.operation!=="select"||
         body.schema!=="silver"||typeof body.table!=="string")
        return json({error:{message:"Backup is read-only"}},403);
      resolvingTarget=true;
      // Only an explicitly requested, enabled backup needs its saved connection profile.
      // This metadata lookup is NOT a routing decision.
      const control=await databaseForTarget(controlTarget);
      const selected=(await databaseListForControl(control))
        .find(item=>item.target_id===routing.backupId);
      if(!selected)return json({error:{message:"Configured backup connection was not found"}},503);
      target=selectedDatabaseTarget([{...selected,selected:true}]);
      if(target.provider!==routing.backupProvider)return json({error:{message:"Backup provider differs from repository config"}},503);
      resolvingTarget=false;
    }
    // Supabase remains the explicit control target; "configured" can route to
    // an opt-in custom Kysely primary using only trusted repository settings.
    // No untrusted per-request connection alias selection.
    if(target.provider==="neon"&&(body.kind!=="query"||body.operation!=="select"))
      return json({error:{message:"Neon LOC mirror is read-only"}},403);
    // PostgreSQL mirrors enforce per-row access through RLS, not table-name
    // lists. This older Supabase-hosted Edge transport remains optional; the
    // independent Neon primary/backup never requires it.
    if(target.provider==="neon"&&(body.schema!=="silver"||typeof body.table!=="string"))
      return json({error:{message:"Neon LOC mirror table is not enabled"}},403);
    if(target.provider==="neon"&&role==="anon"){role="anonymous";claims.role=role;}
    // Reject public or unsupported cross-engine actions before opening a
    // connection; private CRUD retains its LOC-managed authorization gate.
    if(target.provider==="custom"||target.engine!=="postgres"){
      if(role!=="authenticated"){
        const publicAnchor=body.kind==="anchor"&&
          (body.attr?.op===undefined||body.attr?.op==="read"||body.attr?.op==="catalog");
        const publicAnalytics=body.kind==="analytics";
        const publicAction=body.kind==="public-action"&&
          ["read_app_bootstrap","read_scope_page_copy","search_scope_trace_place_names"].includes(String(body.name));
        if(!publicAnchor&&!publicAnalytics&&!publicAction)assertCrossEnginePublicRead(body);
      }else if(!["query","managed-write","anchor","analytics","public-action"].includes(String(body.kind)))
        return json({error:{message:"Unsupported SQL target action"}},403);
    }
    // Logical data sources are registered on the trusted SQL Gateway, not
    // selected by a browser. An empty registry preserves original behavior.
    const queryScope=federatedScopeFromQuery(body);
    const datasets=requestedTarget==="configured"&&queryScope
      ?federatedDatasetsFor(Deno.env.get("LOC_SEARCH_DATASETS_JSON")||"",queryScope)
      :[];
    if(requestedTarget==="configured"&&datasets.length>1&&
       body.expectedDbId===undefined&&isFederatedTextSearch(body)){
      // One external index lookup for all configured datasets. If it is not
      // fully covered or available, every source retains the SQL text query.
      // This is a read-only operation; it never sends article contents to KV.
      const indexed=await federatedIndexedCandidates(body,datasets);
      const merged=await mergeFederatedGalaxyRows(datasets,body,async(source,page)=>{
        const candidates=indexed?.get(source.databaseId);
        if(candidates?.size){
          page={...page,filters:[...(page.filters||[]),{
            column:"uid",operator:"in",value:[...candidates]
          }]};
        }
        const readTarget=source.target;
        const readDb=isControlTarget(readTarget)
          ?await databaseForTarget(controlTarget)
          :await databaseForTarget(readTarget,{profileLookup:profileForTarget});
        // The *same* signed LOC claims and Kysely policy checks apply to each
        // database. No per-UID SQL queries, no SQL provider API and no RLS
        // assumption beyond the existing optional PostgreSQL session.
        const pageResult=await readDb.transaction().execute(trx=>
          executeRequest(trx,readTarget,role,claims,page));
        return pageResult?.data||[];
      });
      return json(merged);
    }
    // One-source federation is still a real logical route and must not
    // silently read the control/primary database instead.
    if(requestedTarget==="configured"&&datasets.length===1&&
       body.expectedDbId===undefined&&isFederatedTextSearch(body))
      target=datasets[0].target;
    // A qualified article read is an assertion against a server-authorized
    // Scope dataset. Identical UIDs across databases are not interchangeable.
    if(body.expectedDbId!==undefined){
      const expected=String(body.expectedDbId||'');
      if(!isDatasetQualifiedArticleRead(body)||!expected)
        return json({error:{message:"Invalid qualified article read"}},400);
      const matched=datasets.find(item=>item.databaseId===expected);
      if(matched)target=matched.target;
      else if(expected!==searchIndexDatabaseId(target))
        return json({error:{message:"Article database does not match the authorized SQL route"}},409);
    }
    // A complete external index can narrow only this one SELECT's UID set.
    // Incomplete, unavailable or ambiguous indexes fall back to the original
    // SQL query without affecting permissions, sort order or pagination.
    if(requestedTarget==="configured")
      body=await withIndexedCandidates(body,target);
    const db=isControlTarget(target)
      ?await databaseForTarget(controlTarget)
      :await databaseForTarget(target,{profileLookup:profileForTarget});
    // A portable Scope database holds only Galaxy/Anchor. The LOC-signed
    // delegation contains its permission boundary: no control DB round trip.
    // Four fixed publicly readable LOC control models use the existing
    // ZenStack V3 runtime. Model-mapped $qb is policy-rewritten in V3.10.1,
    // but the trusted Gateway/SQL remains the authorization boundary.
    // The same existing dialect/pool,
    // transaction, JWT binding and response shape are retained; no second DB
    // connection or permission lookup is introduced.
    const policyModel=fixedPolicyReadModel(target,body);
    // Only the LOC control-plane's signed global administrator can use a
    // ZenStack fixed-model mutation. Dynamic scopes stay on existing Kysely.
    const adminWrite=isControlTarget(target)&&
      fixedPolicyWriteModel(target,body,role,claims);
    const policyDeps=(policyModel||adminWrite)
      ?{dialect:trustedDialectForDatabase(db),ZenStackClient,PolicyPlugin}:null;
    // Reuse this trusted database dialect; private reads still require
    // signed LOC credentials and the existing Gateway/SQL access checks.
    const scopeMatch=target.engine==="postgres"&&role==="authenticated"&&
      claims?.provider==="loc"&&claims?.me===true&&
      body.kind==="query"&&body.operation==="select"&&body.schema==="silver"
      ?/^([a-z][a-z0-9]{0,14})_(galaxy|anchor|blocks)$/.exec(String(body.table||""))
      :null;
    const nativeScopeModel=scopeMatch
      ?scopeMatch[2][0].toUpperCase()+scopeMatch[2].slice(1)
      :undefined;
    const result=policyModel
      ?await withFixedPolicyRead(db,target,body,role,claims,policyDeps,
        (trx,modelName,ormClient)=>executeRequest(trx,target,role,claims,body,{modelName,ormClient}))
      :adminWrite
        ?await withFixedPolicyWrite(db,target,body,role,claims,policyDeps,
          (trx,modelName)=>executeRequest(trx,target,role,claims,body,{modelName}))
        :scopeMatch
          ?await new ZenStackClient(scopedZModelSchema({
            scopeId:scopeMatch[1],
            namespace:String(target.schema_name||body.schema)
          }),{dialect:trustedDialectForDatabase(db)}).$transaction(ormClient=>
            executeRequest(ormClient.$qb,target,role,claims,body,
              {ormClient,nativeScopeModel}))
          :await db.transaction().execute(trx=>
            executeRequest(trx,target,role,claims,body));
    // Search-only response metadata: no physical SQL column is added.
    // The browser can preserve two distinct results with the same UID
    // when future Gateway federated reads return multiple logical datasets.
    if(body.kind==="query"&&body.operation==="select"&&
       body.indexHint&&String(body.table||"").endsWith("_galaxy")&&
       Array.isArray(result.data)){
      const dbId=searchIndexDatabaseId(target);
      if(dbId)result.data=result.data.map(row=>({...row,__db_id:dbId}));
    }
    // Index ingestion occurs only after the SQL transaction commits. A KV
    // outage never changes the result of an authorized SQL write.
    if(isSearchIndexConfigured()){
      const writeTable=String(body.kind==="managed-write"
        ?(body.payload as Record<string,unknown>||{}).p_table||""
        :body.table||"").replace(/^silver\./,"");
      const scope=writeTable.match(/^([a-z][a-z0-9]{0,14})_galaxy$/)?.[1];
      const indexedTarget=scope?indexTargetForScope(
        Deno.env.get("LOC_SEARCH_DATASETS_JSON")||"",scope,target):null;
      const docs=indexedTarget?indexDocumentsFromWrite(body,indexedTarget):[];
      if(docs.length&&Number(result?.data?.count??result?.count??1)>0){
        const indexed=await writeSearchIndexDocuments(docs);
        if(!indexed)console.warn('[loc-search-index] Galaxy write index update incomplete');
      }
    }
    return json(result,200,result.count===null?{}:{"content-range":`0-${Math.max(0,(Array.isArray(result.data)?result.data.length:0)-1)}/${result.count}`});
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if(code==="57014"&&textSearch)
      return json({error:{message:"搜尋執行逾時，請縮小查詢範圍",code:"SEARCH_TIMEOUT"}},408);
    const transientConnectionFailure = code === "53300" || code.startsWith("08") || /connection (?:terminated|timeout)|remaining connection slots/i.test(message);
    const status = (error && typeof error === 'object' && 'httpStatus' in error) ? Number(error.httpStatus) : resolvingTarget || transientConnectionFailure ? 503 : isKyselyClientError(error) ? 400 : 500;
    if (status >= 500) console.error("[loc-kysely] Database request failed", error);
    const responseMessage = status === 400 || status === 403 || status === 409 ? message : resolvingTarget ? "Selected database target is unavailable" : status === 503 ? "Database is temporarily unavailable" : "Database request failed";
    return json({ error: { message: responseMessage, code: code || undefined } }, status);
  }
});
