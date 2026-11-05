import { sql } from "npm:kysely@0.29.8";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5.9.6";
import {clerkSqlClaims} from "../../../app/loc/auth/clerk-sql-claims.mjs";
import {databaseForTarget,resolveConnectionProfile} from "./drivers.ts";
import {readVaultConnection} from "./database-connections.ts";
import { executeKyselyQuery, isKyselyClientError } from "../../../app/loc/providers/kysely-runtime.mjs";
import {executeManagedKyselyWrite,executeManagedKyselyAction} from "../../../app/loc/providers/kysely-management.mjs";
import {saveBlocksKysely} from "../../../app/loc/providers/kysely-blocks.mjs";
import {executeKyselyAnchor,executePortableKyselyAnchor} from "../../../app/loc/providers/kysely-anchor.mjs";
import {executeKyselyAnalytics,executePortableKyselyAnalytics} from "../../../app/loc/providers/kysely-analytics.mjs";
import {executeKyselyPublicAction} from "../../../app/loc/providers/kysely-public.mjs";
import {executeKyselyScopeAdmin} from "../../../app/loc/providers/kysely-scope-admin.mjs";
import {ensurePortableScopeSchema,validatePortableScopeSchema} from "../../../app/loc/providers/kysely-schema.mjs";
import { selectedDatabaseTarget } from "../../../app/loc/providers/selected-database-target.mjs";
import {resolveSqlExecutionPort,assertCrossEnginePublicRead,authorizeCrossEngineQuery,executeCrossEngineManagedWrite} from "../../../app/loc/providers/sql-engine-ports.mjs";
import {resolveDatabaseRouting} from "../../../app/loc/providers/routing-config.mjs";
import {databaseAccessTargets} from "../../../app/loc/providers/access.js";
import {isTextSearchQuery,checkSearchQos} from "../../../app/loc/providers/search-qos.mjs";
import {bindLocAuthorization,canManageLoc,locPermissions} from "../../../app/loc/providers/loc-authorization.mjs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const clerkIssuer=(Deno.env.get("LOC_CLERK_ISSUER")||
  "https://precise-grackle-3371.clerk.accounts.dev").replace(/\/$/,"");
const clerkOrigin=(Deno.env.get("LOC_CONTROL_ORIGIN")||
  "https://loc.lo3rwang.cc").replace(/\/$/,"");
if(new URL(clerkIssuer).protocol!=="https:"||
  new URL(clerkIssuer).pathname!=="/"||
  new URL(clerkOrigin).protocol!=="https:"||
  new URL(clerkOrigin).pathname!=="/")
  throw new Error("Clerk issuer and LOC origin must be HTTPS origins");
const clerkKeys=createRemoteJWKSet(new URL(clerkIssuer+"/.well-known/jwks.json"));
const mcpResource="https://loc.lo3rwang.cc/mcp";
async function verifyClerkForSql(token:string){
  const {payload}=await jwtVerify(token,clerkKeys,{
    issuer:clerkIssuer,algorithms:["RS256"]
  });
  // Normal Clerk session tokens do not promise signed email claims.
  // Only the independent Authority may bind this signed sub/sid to its
  // single, preconfigured root management identity.
  let trustedEmail='';
  if(payload.email_verified!==true||typeof payload.email!=='string'){
    const reply=await fetch('https://auth.lo3rwang.cc/v1/identity',{
      method:'GET',headers:{authorization:'Bearer '+token,origin:clerkOrigin,accept:'application/json'},
      signal:AbortSignal.timeout(8000)
    });
    if(!reply.ok)throw new Error('LOC Authority could not verify Clerk root identity');
    const identity=await reply.json();
    if(identity?.provider!=='clerk'||identity.subject!==payload.sub||
        identity.session!==payload.sid)
      throw new Error('LOC Authority Clerk identity mismatch');
    trustedEmail=String(identity.email||'');
  }
  return clerkSqlClaims(payload,{issuer:clerkIssuer,origin:clerkOrigin,trustedEmail});
}
async function verifyMcpForSql(token:string,scopeid:string){
  const {payload}=await jwtVerify(token,clerkKeys,{
    issuer:clerkIssuer,audience:mcpResource,algorithms:["RS256"]
  });
  if(!/^user_[A-Za-z0-9]+$/.test(String(payload.sub||""))||
    !["lo3rwang","lrunes"].includes(scopeid))
    throw new Error("MCP identity or Scope invalid");
  // Independent Authority verifies the same OAuth JWT and its exact Scope
  // WRITE permission. Only the existing LOC root may use managed SQL writes.
  const result=await fetch(
    "https://auth.lo3rwang.cc/v1/mcp/authorize-write/"+scopeid,{
    method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
    redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if(!result.ok)throw new Error("MCP Scope write permission denied");
  const identity=await result.json();
  if(identity?.provider!=="clerk"||identity.authorized!==true||
    identity.subject!==payload.sub||identity.scopeid!==scopeid||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(identity.email||"")))
    throw new Error("Verified MCP identity does not match Scope owner");
  return {role:"authenticated",sub:payload.sub,iss:payload.iss,
    email:String(identity.email).toLowerCase(),provider:"clerk"};
}
function configuredPublishableKeys() {
  const keys = [Deno.env.get("LOC_KYSELY_PUBLISHABLE_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), Deno.env.get("SUPABASE_ANON_KEY")].filter((value): value is string => Boolean(value));
  try {
    const keyMap = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (keyMap && typeof keyMap === "object" && !Array.isArray(keyMap)) keys.push(...Object.values(keyMap).filter((value): value is string => typeof value === "string"));
  } catch {
    console.error("[loc-kysely] SUPABASE_PUBLISHABLE_KEYS is not valid JSON");
  }
  return new Set(keys);
}
const publishableKeys = configuredPublishableKeys();
// The deployed function and browser use the same source-controlled routing contract.
const routing = resolveDatabaseRouting();
// Cross-engine publicly readable tables are centrally enforced by sql-engine-ports.mjs.

const controlTarget={provider:"supabase",engine:"postgres",connection_alias:"supabase_current",connection_mode:"pooler"};

function isSupabaseControlTarget(target:Record<string,unknown>){
  if(target.provider!=="supabase"||target.engine!=="postgres"||target.connection_alias!=="supabase_current")return false;
  const link=String(target.project_url||"").replace(/\/$/,"");
  return !link||link===supabaseUrl.replace(/\/$/,"");
}


const profileCache=new Map<string,{until:number,profile:any}>();
async function profileForTarget(target:Record<string,unknown>){
  if(isSupabaseControlTarget(target))return resolveConnectionProfile(controlTarget);
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
  const control=await databaseForTarget(controlTarget);
  const valid=await control.transaction().execute(async trx=>{
    await sql`set local role authenticated`.execute(trx);
    await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
    await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
    bindLocAuthorization(trx,{role:'authenticated',claims});
    return await canManageLoc(trx,'global');
  });
  if(!valid)throw Object.assign(new Error("Administrator permission required"),{httpStatus:403});
  return control;
}
// Database access metadata is loaded once from the deployment JS file.
// This must never SELECT silver.manage.database (or LOC) on requests.
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
  return selected.provider==='supabase'&&selected.connection_alias==='supabase_current'
    ?controlTarget:selectedDatabaseTarget([{...selected,selected:true}]);
}

async function executeRequest(trx: any, target: Record<string,any>, role: string,
  claims: Record<string, unknown>, body: Record<string, unknown>,
  snapshot:any=null) {
  const executionPort=resolveSqlExecutionPort(target);
  bindLocAuthorization(trx,{role,claims,snapshot});
  if(target.provider==="custom"||executionPort.session!=="postgres-rls"){
    // No PostgreSQL RLS on other engines. Authorize each request against
    // the target Scope Registry using the already verified Clerk identity.
    if(body.kind==="managed-write"){
      if(role!=="authenticated")
        throw Object.assign(new Error("Management requires verified Clerk identity"),{httpStatus:403});
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
    return await executeKyselyQuery(trx,body,{dialect:executionPort.engine,
      namespace:String(target.schema_name||(
        executionPort.engine==='mssql'?'dbo':'public')),
      publicOnly:access?.publicOnly===true});
  }
  if (role === "authenticated") await sql`set local role authenticated`.execute(trx);
  else if (target.provider === "neon") await sql`set local role anonymous`.execute(trx);
  else await sql`set local role anon`.execute(trx);
  await sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`.execute(trx);
  await sql`select set_config('request.jwt.claim.sub', ${String(claims.sub || "")}, true)`.execute(trx);
  await sql`select set_config('request.jwt.claim.role', ${role}, true)`.execute(trx);
  if(body.kind==="query"){
    // PostgreSQL must stop work even when browser aborts its 25s timeout.
    if(isTextSearchQuery(body))
      await sql`set local statement_timeout = '8000ms'`.execute(trx);
    return await executeKyselyQuery(trx,body);
  }
  if(body.kind==="anchor")return await executeKyselyAnchor(trx,body,{role,claims});
  if(body.kind==="analytics")return await executeKyselyAnalytics(trx,body,{role});
  if(body.kind==="public-action")return await executeKyselyPublicAction(trx,body);
  if(body.kind==="managed-write"||body.kind==="managed-action"){
    if(role!=="authenticated")throw Object.assign(new Error("Management requires a verified session"),{httpStatus:403});
    return body.kind==="managed-write"
      ?await executeManagedKyselyWrite(trx,body)
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

function tokenPayload(token: string) {
  const part = token.split(".")[1];
  if (!part) throw new Error("Malformed access token");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);
  const apiKey = request.headers.get("apikey") || "";
  if (!apiKey || !publishableKeys.has(apiKey)) {
    return json({ error: { message: "Invalid API key" } }, 401);
  }

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
  let claims: Record<string, unknown> = { role };
  let verifiedMcp=false;
  const authorization = request.headers.get("authorization") || "";
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: { message: "Invalid authorization header" } }, 401);
    const token = match[1];
    let untrusted:Record<string,unknown>;
    try{untrusted=tokenPayload(token);}
    catch{return json({error:{message:"Invalid session token"}},401);}
    if(untrusted.iss===clerkIssuer){
      // MCP OAuth JWTs and interactive Clerk sessions have different audiences
      // and permissions. Never let an MCP token execute general SQL requests.
      if(["mcp-sync","mcp-search","mcp-read","mcp-append","mcp-update-pr"].includes(String(body.kind))){
        try{
          claims=await verifyMcpForSql(token,String(body.scopeid||""));
          verifiedMcp=true;
        }catch{
          return json({error:{message:"MCP Scope write authorization rejected"}},403);
        }
      }else{
        if(Array.isArray(untrusted.aud)?untrusted.aud.includes(mcpResource):untrusted.aud===mcpResource)
          return json({error:{message:"MCP tokens cannot execute general database requests"}},403);
        try{
          claims=await verifyClerkForSql(token);
        }catch(error){
          const missingEmail=error instanceof Error&&
            error.message.startsWith("Verified Clerk email claim");
          return json({error:{message:missingEmail
            ?"Clerk session is missing verified email claims"
            :"Invalid or expired Clerk session"}},missingEmail?403:401);
        }
      }
    }else{
      // LOC sessions are exclusively Clerk-issued and verified using the
      // existing LOC Authority. Database-provider OAuth never authenticates
      // a LOC management request, regardless of selected SQL Dialect.
      return json({error:{message:"LOC requires a verified Clerk session"}},401);
    }
    role = "authenticated";
  }

  // Explicit database-target selection is never a public capability.
  // Ordinary visitors use the server-selected configured target only.
  if(requestedTarget!=="configured"){
    if(role!=="authenticated")
      return json({error:{message:"Administrator permission required"}},403);
    try{await checkAdminRole(claims);}
    catch{return json({error:{message:"Administrator permission required"}},403);}
  }

  const textSearch=isTextSearchQuery(body);
  if(textSearch){
    // Uses Clerk subject when verified; otherwise provider-forwarded client
    // IP. Each warm isolate bounds abuse without adding database writes.
    const source=role==="authenticated"&&typeof claims.sub==="string"
      ?"clerk:"+claims.sub
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
    if(body.kind==="mcp-read"||body.kind==="mcp-search"){
      // A Clerk OAuth token is separately verified by the LOC Authority.
      // This owner-only route accepts fixed read shapes, not arbitrary SQL.
      if(!verifiedMcp||role!=="authenticated")
        return json({error:{message:"Verified MCP Scope permission required"}},403);
      if(requestedTarget!=="configured")
        return json({error:{message:"Managed MCP reads use the control database only"}},400);
      const scope=String(body.scopeid||"");
      const isRead=body.kind==="mcp-read";
      const expectedKeys=isRead?["kind","scopeid","uid",...(body.site===undefined?[]:["site"])]:["kind","scopeid","query","limit",...(body.source===undefined?[]:["source"])];
      if(!["lo3rwang","lrunes"].includes(scope)||
         Object.keys(body).length!==expectedKeys.length||
         Object.keys(body).some(key=>!expectedKeys.includes(key)))
        return json({error:{message:"Invalid managed MCP read payload"}},400);
      const uid=String(body.uid||"");
      const query=body.query;
      const limit=body.limit;
      if(isRead){
        if(!/^[A-Za-z0-9]{8}$/.test(uid)||body.site!==undefined&&!["mcp","github"].includes(body.site))
          return json({error:{message:"Invalid managed MCP article UID"}},400);
      }else if(typeof query!=="string"||query.trim().length<2||query.length>100||
          /[\u0000-\u001f\u007f]/.test(query)||!Number.isInteger(limit)||
          Number(limit)<1||Number(limit)>5||!["mcp","github"].includes(body.source??"mcp")){
        return json({error:{message:"Invalid managed MCP search parameters"}},400);
      }
      const db=await databaseForTarget(controlTarget);
      // The scope has already been allowlisted; the identifier is not caller-supplied.
      const table=sql.ref("silver."+scope+"_galaxy");
      const rows=await db.transaction().execute(async trx=>{
        await sql`set local role authenticated`.execute(trx);
        await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.role','authenticated',true)`.execute(trx);
        if(isRead){
          const result=await sql`select uid,title,content,date,createtime,site,url
            from ${table} where uid=${uid} and (${body.site===undefined} or site=${body.site||""}) limit 1`.execute(trx);
          return result.rows;
        }
        const pattern="%"+String(query).trim().replace(/[\\%_]/g,"\\$&")+"%";
        await sql`set local statement_timeout = '4000ms'`.execute(trx);
        const result=await sql`select uid,title,createtime from ${table}
          where site = ${body.source??'mcp'} and (title ilike ${pattern} or content ilike ${pattern})
          order by createtime desc nulls last limit ${Number(limit)}`.execute(trx);
        return result.rows;
      });
      return json({data:rows});
    }
    if(body.kind==="mcp-append"){
      if(!verifiedMcp||role!=="authenticated") return json({error:{message:"MCP authorization required"}},403);
      const scope=String(body.scopeid||"");
      const uid=String(body.uid||"");
      const content=body.content;
      const batchId=String(body.batch_id||"");
      const marker="[[GalaxyLinkBatch:"+batchId+"]]";
      const stamp=String(body.updated_at||"");
      if(!["lo3rwang","lrunes"].includes(scope)||!/^[A-Za-z0-9]{8}$/.test(uid)||
         typeof content!=="string"||!content.trim()||content.length>125000||
         !/^[0-9a-f]{64}$/.test(batchId)||!content.startsWith(marker+"\n")||
         !Number.isFinite(Date.parse(stamp))) return json({error:{message:"Invalid append request"}},400);
      const db=await databaseForTarget(controlTarget);
      const table=sql.ref("silver."+scope+"_galaxy");
      const result=await db.transaction().execute(async trx=>{
        await sql`set local role authenticated`.execute(trx);
        await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.role','authenticated',true)`.execute(trx);
        await sql`set local statement_timeout = '5000ms'`.execute(trx);
        const next=await sql`update ${table} set content=concat_ws(chr(10),nullif(content,''),${content}),
          "UpdateTime"=${stamp} where uid=${uid} and site='mcp'
          and position(${marker} in coalesce(content,''))=0
          returning uid,title,createtime`.execute(trx);
        if(next.rows.length===1)
          return {data:{count:1,title:next.rows[0].title,createtime:next.rows[0].createtime}};
        const duplicate=await sql`select uid,title,createtime from ${table}
          where uid=${uid} and site='mcp' and position(${marker} in coalesce(content,''))>0
          limit 1`.execute(trx);
        if(duplicate.rows.length===1)
          return {data:{count:1,duplicate:true,title:duplicate.rows[0].title,createtime:duplicate.rows[0].createtime}};
        throw Error("MCP topic unavailable");
      });
      return json(result);
    }
    if(body.kind==="mcp-sync"){
      if(!verifiedMcp||role!=="authenticated")
        return json({error:{message:"Verified MCP write permission required"}},403);
      const scope=String(body.scopeid||"");
      // A signed MCP conversation is private irrespective of supplied flags.
      const incomingRow=body.row as Record<string,unknown>;
      const flags=["statics","culture","search","trace","list","keyword","extract","others"];
      const base=["uid","title","content","site","site_id","createtime","UpdateTime"];
      const row=incomingRow&&typeof incomingRow==="object"&&!Array.isArray(incomingRow)
        ? Object.fromEntries([...base.map(key=>[key,key==="site"?"mcp":incomingRow[key]]),
            ...flags.map(key=>[key,false])])
        :incomingRow;
      const expected=[...base,...flags];
      if(!["lo3rwang","lrunes"].includes(scope)||!row||typeof row!=="object"||
        Array.isArray(row)||Object.keys(row).length!==expected.length||
        Object.keys(row).some(k=>!expected.includes(k))||
        !/^[A-Za-z0-9]{8}$/.test(String(row.uid||""))||
        typeof row.title!=="string"||row.title.length>350||
        typeof row.content!=="string"||!row.content.trim()||
        row.content.length>125000||row.site!=="mcp"||
        typeof row.site_id!=="string"||row.site_id.length<3||
        row.site_id.length>150||
        !incomingRow||Object.keys(incomingRow).some(k=>!expected.includes(k))||
        flags.some(k=>row[k]!==false)||
        typeof row.createtime!=="string"||typeof row.UpdateTime!=="string"||
        typeof body.update_existing!=="boolean")
        return json({error:{message:"Invalid managed conversation payload"}},400);
      const table="silver."+scope+"_galaxy";
      const db=await databaseForTarget(controlTarget);
      const result=await db.transaction().execute(async trx=>{
        if(body.update_existing){
          const values={...row};
          delete values.uid;
          const update=await executeRequest(trx,controlTarget,"authenticated",claims,
            scope==="lo3rwang"
              ?{kind:"query",schema:"silver",table:scope+"_galaxy",operation:"update",
                values,filters:[{column:"uid",operator:"eq",value:row.uid},
                  {column:"site_id",operator:"eq",value:row.site_id}]}
              :{kind:"managed-write",payload:{p_table:table,p_operation:"update",p_values:values,
                  p_filters:[{column:"uid",operator:"eq",value:row.uid},
                    {column:"site_id",operator:"eq",value:row.site_id}]}});
          const updatedCount=update?.count??update?.data?.count;
          if(updatedCount===1)return {data:{count:1},count:1};
          if(updatedCount!==0)throw new Error("Unexpected managed sync update count");
        }
        return executeRequest(trx,controlTarget,"authenticated",claims,{
          kind:"managed-write",payload:{p_table:table,p_operation:"insert",p_rows:[row]}
        });
      });
      return json(result);
    }
    if(body.kind==="mcp-update-pr"){
      // Updates an EXISTING Galaxy article in place. Unlike mcp-sync (which
      // upserts private conversations), this never creates a new row: it only
      // rewrites an article that is already tagged as GitHub PR origin and
      // whose current title names the same PR number the caller supplied.
      if(!verifiedMcp||role!=="authenticated")
        return json({error:{message:"Verified MCP write permission required"}},403);
      const scope=String(body.scopeid||"");
      const expected=["kind","scopeid","pr_number","title","content","updated_at"];
      const allowed=[...expected,"uid"];
      const prNumber=body.pr_number;
      if(!["lo3rwang","lrunes"].includes(scope)||
        Object.keys(body).length!==expected.length+(body.uid===undefined?0:1)||
        Object.keys(body).some(key=>!allowed.includes(key))||
        (body.uid!==undefined&&!/^[A-Za-z0-9]{8}$/.test(String(body.uid)))||
        !Number.isInteger(prNumber)||Number(prNumber)<1||Number(prNumber)>9999999||
        typeof body.title!=="string"||!body.title.trim()||body.title.length>350||
        typeof body.content!=="string"||!body.content.trim()||body.content.length>125000||
        typeof body.updated_at!=="string"||!body.updated_at)
        return json({error:{message:"Invalid PR update payload"}},400);
      let uid=String(body.uid||"");
      const table="silver."+scope+"_galaxy";
      const tableRef=sql.ref(table);
      const db=await databaseForTarget(controlTarget);
      const result=await db.transaction().execute(async trx=>{
        await sql`set local role authenticated`.execute(trx);
        await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.role','authenticated',true)`.execute(trx);
        // The user knows their GitHub PR number, not its random Galaxy UID.
        // Locate by stable source identity first. Do not search private content,
        // infer an arbitrary UID, or write when multiple candidates exist.
        const repoSiteId="EsotericVerse/moon-runes-pwa#"+prNumber;
        const prMarker=new RegExp("(?:^|[^0-9])PR\\s*#"+Number(prNumber)+"(?:[^0-9]|$)");
        let rows:{uid:string;title:string;site:string;site_id:string|null}[];
        if(uid){
          const existing=await sql<{uid:string;title:string;site:string;site_id:string|null}>`
            select uid,title,site,site_id from ${tableRef} where uid=${uid} limit 1`.execute(trx);
          rows=existing.rows;
        }else{
          const exact=await sql<{uid:string;title:string;site:string;site_id:string|null}>`
            select uid,title,site,site_id from ${tableRef}
            where site='github' and site_id=${repoSiteId} limit 2`.execute(trx);
          rows=exact.rows;
          if(rows.length===0){
            const fallback=await sql<{uid:string;title:string;site:string;site_id:string|null}>`
              select uid,title,site,site_id from ${tableRef}
              where site='github' and title ilike ${'%PR #'+prNumber+'%'}
              order by createtime desc nulls last limit 40`.execute(trx);
            rows=fallback.rows.filter(row=>prMarker.test(String(row.title||'')));
          }
          if(rows.length!==1)
            throw Object.assign(new Error(rows.length?'Multiple PR articles match; refusing ambiguous update':
              'Existing GitHub PR record not found'),{httpStatus:409});
          uid=rows[0].uid;
        }
        const row=rows[0];
        if(!row)throw Object.assign(new Error("Scope article not found"),{httpStatus:404});
        if(row.site!=="github")
          throw Object.assign(new Error("Only GitHub PR-origin articles can be updated through this tool"),{httpStatus:403});
        if(row.site_id!==repoSiteId&&!prMarker.test(String(row.title||'')))
          throw Object.assign(new Error("PR number does not match article provenance"),{httpStatus:403});
        const values={title:body.title,content:body.content,UpdateTime:body.updated_at};
        const updated=await executeRequest(trx,controlTarget,"authenticated",claims,
          scope==="lo3rwang"
            ?{kind:"query",schema:"silver",table:scope+"_galaxy",operation:"update",
              values,filters:[{column:"uid",operator:"eq",value:uid}]}
            :{kind:"managed-write",payload:{p_table:table,p_operation:"update",p_values:values,
                p_filters:[{column:"uid",operator:"eq",value:uid}]}});
        const count=updated?.count??updated?.data?.count;
        if(count!==1)throw new Error("Managed PR update affected an unexpected number of rows");
        return {data:{count:1,uid},count:1};

      });
      return json(result);
    }
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
    // The old admin RPCs must not pretend to switch an immutable, deployed route.
    if(body.kind==="rpc"&&body.schema==="silver"&&
       (body.name==="set_database_target"||body.name==="set_database_routing"))
      return json({error:{message:"Database routing is set in app/loc/providers/routing-config.mjs and requires deployment"}},409);

    // LOC registry, user settings and public presentation are control-plane
    // actions. A user-managed SQL target only needs its own data tables.
    const controlManage=new Set(["manage","read_group_members",
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
    // connection; private CRUD receives a second, row-owner ACL gate in
    // executeRequest after verified Clerk claims have been established.
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
    const db=isSupabaseControlTarget(target)
      ?await databaseForTarget(controlTarget)
      :await databaseForTarget(target,{profileLookup:profileForTarget});
    // The LOC control database supplies authorization; a user's external
    // database needs its own Galaxy/Anchor data tables, not LOC RPC/ACL tables.
    let permissionSnapshot=null;
    if(target.provider==="custom"&&role==="authenticated"){
      const control=await databaseForTarget(controlTarget);
      permissionSnapshot=await control.transaction().execute(async trx=>{
        await sql`set local role authenticated`.execute(trx);
        bindLocAuthorization(trx,{role,claims});
        return await locPermissions(trx);
      });
    }
    const result=await db.transaction().execute(trx=>
      executeRequest(trx,target,role,claims,body,permissionSnapshot));
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
