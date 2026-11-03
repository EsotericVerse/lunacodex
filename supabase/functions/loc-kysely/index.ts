import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sql } from "npm:kysely@0.29.6";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5.9.6";
import {clerkSqlClaims} from "../../../app/loc/auth/clerk-sql-claims.mjs";
import {databaseForTarget,resolveConnectionProfile} from "./drivers.ts";
import {makeConnectionProfile,readVaultConnection,saveVaultConnection} from "./database-connections.ts";
import {normalizeDatabaseLocation} from "../../../app/loc/providers/database-link.mjs";
import { executeAllowlistedRpc, executeKyselyQuery, isKyselyClientError } from "../../../app/loc/providers/kysely-runtime.mjs";
import { selectedDatabaseTarget } from "../../../app/loc/providers/selected-database-target.mjs";
import {resolveSqlExecutionPort,assertCrossEnginePublicRead} from "../../../app/loc/providers/sql-engine-ports.mjs";
import {resolveDatabaseRouting} from "../../../app/loc/providers/routing-config.mjs";

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
    const reply=await fetch('https://loc-authority-control.sopa2306.workers.dev/v1/identity',{
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
    "https://loc-authority-control.sopa2306.workers.dev/v1/mcp/authorize-write/"+scopeid,{
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


async function profileForTarget(target:Record<string,unknown>){
  // The selected primary Supabase control project already has its trusted
  // connection URL in Edge secrets. Do not open a second connection or read
  // Vault on every ordinary public request.
  if(isSupabaseControlTarget(target))return resolveConnectionProfile(controlTarget);
  const control=await databaseForTarget(controlTarget);
  const secret=await readVaultConnection(control,target);
  if(secret)return secret;
  const profile=resolveConnectionProfile(target);
  if(typeof target.project_url==="string"&&target.project_url){
    const location=normalizeDatabaseLocation(String(target.provider),target.project_url);
    if(target.provider==="supabase"){
      if(location.projectId!==new URL(supabaseUrl).hostname.split(".")[0])
        throw Object.assign(new Error("Supabase Link has no matching saved credentials"),{httpStatus:400});
    }else if(target.provider==="neon"){
      if(location.host!==new URL(profile.url).hostname)
        throw Object.assign(new Error("Neon Link has no matching saved credentials"),{httpStatus:400});
    }
  }
  return profile;
}
async function checkAdminRole(claims:Record<string,unknown>){
  const control=await databaseForTarget(controlTarget);
  const valid=await control.transaction().execute(async trx=>{
    await sql`set local role authenticated`.execute(trx);
    await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
    await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
    const result=await sql<{allowed:boolean}>`select coalesce((select allowed from silver.manage('global')),false) as allowed`.execute(trx);
    return result.rows[0]?.allowed===true;
  });
  if(!valid)throw Object.assign(new Error("Administrator permission required"),{httpStatus:403});
  return control;
}
// LOC owns the database target list; only its private JSONB column is read.
async function databaseListForControl(control:any):Promise<Record<string,any>[]>{
  const row=await control.selectFrom("silver.loc").select("database")
    .where("id","=","loc").executeTakeFirst();
  if(!Array.isArray(row?.database))throw new Error("LOC database routing list is missing");
  return row.database;
}
async function saveDatabaseTarget(input:Record<string,unknown>,role:string,claims:Record<string,unknown>){
  if(role!=="authenticated")throw Object.assign(new Error("Sign in as administrator"),{httpStatus:403});
  if(!input||typeof input!=="object"||Array.isArray(input))throw Object.assign(new Error("Invalid target payload"),{httpStatus:400});
  const targetId=String(input.target_id||"");
  if(!/^[a-z][a-z0-9_-]{0,80}$/i.test(targetId))throw Object.assign(new Error("Invalid target ID"),{httpStatus:400});
  const engine=String(input.engine||"postgres");
  const provider=String(input.provider||"custom");
  const alias=String(input.connection_alias||targetId.replaceAll("-","_"));
  const target=selectedDatabaseTarget([{provider,engine,connection_alias:alias,connection_mode:String(input.connection_mode||"direct"),selected:true}]);
  const location=normalizeDatabaseLocation(provider,input.project_url);
  const region=String(input.region||"").trim();
  if(region.length>64||!/^([a-z0-9-]+)?$/.test(region))throw Object.assign(new Error("Invalid Region"),{httpStatus:400});
  const label=String(input.label||targetId).trim();
  if(!label||label.length>160)throw Object.assign(new Error("Invalid target label"),{httpStatus:400});
  const password=typeof input.password==="string"?input.password:"";
  if(input.activate===true)throw Object.assign(new Error("Database routing is managed in the repository config, not in SQL"),{httpStatus:409});
  const profile=password?makeConnectionProfile({...target,...input,project_url:location.link},password):null;
  const control=await checkAdminRole(claims);
  if(!profile)await profileForTarget({...target,project_url:location.link});
  const record={
    provider,engine,connection_alias:alias,connection_mode:target.connection_mode,
    label,project_id:provider==="supabase"?location.projectId:String(input.project_id||"")||null,
    project_url:location.link,region,updated_at:new Date()
  };
  return control.transaction().execute(async trx=>{
    if(profile)await saveVaultConnection(trx,alias,profile);
    const current=await trx.selectFrom("silver.loc").select("database")
      .where("id","=","loc").forUpdate().executeTakeFirst();
    if(!Array.isArray(current?.database))throw new Error("LOC database list is unavailable");
    const exists=current.database.find((item:Record<string,any>)=>item.target_id===targetId);
    const next=exists?current.database.map((item:Record<string,any>)=>
      item.target_id===targetId?{...item,...record}:item):
      [...current.database,{...record,target_id:targetId,selected:false,
        backup_selected:false,routing_mode:"single"}];
    await trx.updateTable("silver.loc").set({database:sql`${JSON.stringify(next)}::jsonb`})
      .where("id","=","loc").execute();
    return {target_id:targetId,provider,engine,selected:targetId===routing.primaryId};
  });
}

async function executeRequest(trx: any, target: Record<string,any>, role: string, claims: Record<string, unknown>, body: Record<string, unknown>) {
  const executionPort=resolveSqlExecutionPort(target);
  if(executionPort.session!=="postgres-rls"){
    // No PostgreSQL RLS or set-local-role on other engines. Until the target's
    // authorization adapter exists, permit only the public LOC read surface.
    assertCrossEnginePublicRead(body);
    return await executeKyselyQuery(trx,body,{dialect:executionPort.engine});
  }
  if (role === "authenticated") await sql`set local role authenticated`.execute(trx);
  else if (target.provider === "neon") await sql`set local role anonymous`.execute(trx);
  else await sql`set local role anon`.execute(trx);
  await sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`.execute(trx);
  await sql`select set_config('request.jwt.claim.sub', ${String(claims.sub || "")}, true)`.execute(trx);
  await sql`select set_config('request.jwt.claim.role', ${role}, true)`.execute(trx);
  if(body.kind==="query")return await executeKyselyQuery(trx,body);
  return await executeAllowlistedRpc(trx,body);
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
      if(["mcp-sync","mcp-search","mcp-read","mcp-update-pr"].includes(String(body.kind))){
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
      const authClient = createClient(supabaseUrl, apiKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) return json({ error: { message: "Invalid or expired session" } }, 401);
      claims = untrusted;
      if (claims.sub !== data.user.id) return json({ error: { message: "Session subject mismatch" } }, 401);
      claims.role = "authenticated";
    }
    role = "authenticated";
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
      const expectedKeys=isRead?["kind","scopeid","uid"]:["kind","scopeid","query","limit"];
      if(!["lo3rwang","lrunes"].includes(scope)||
         Object.keys(body).length!==expectedKeys.length||
         Object.keys(body).some(key=>!expectedKeys.includes(key)))
        return json({error:{message:"Invalid managed MCP read payload"}},400);
      const uid=String(body.uid||"");
      const query=body.query;
      const limit=body.limit;
      if(isRead){
        if(!/^[A-Za-z0-9]{8}$/.test(uid))
          return json({error:{message:"Invalid managed MCP article UID"}},400);
      }else if(typeof query!=="string"||query.trim().length<2||query.length>100||
          /[\u0000-\u001f\u007f]/.test(query)||!Number.isInteger(limit)||
          Number(limit)<1||Number(limit)>20){
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
            from ${table} where uid=${uid} limit 1`.execute(trx);
          return result.rows;
        }
        const pattern="%"+String(query).trim().replace(/[\\%_]/g,"\\$&")+"%";
        const result=await sql`select uid,title,date,createtime from ${table}
          where (title ilike ${pattern} or content ilike ${pattern})
          order by createtime desc nulls last limit ${Number(limit)}`.execute(trx);
        return result.rows;
      });
      return json({data:rows});
    }
    if(body.kind==="mcp-sync"){
      if(!verifiedMcp||role!=="authenticated")
        return json({error:{message:"Verified MCP write permission required"}},403);
      const scope=String(body.scopeid||"");
      // MCP sync is a private conversation source, regardless of the caller's
      // legacy site/able payload. Never inherit Galaxy's all-true defaults.
      const incomingRow=body.row as Record<string,unknown>;
      const row=incomingRow&&typeof incomingRow==="object"&&!Array.isArray(incomingRow)
        ? {...incomingRow,site:"mcp",able:{
            statics:false,culture:false,search:false,trace:false,
            list:false,keywords:false,game:false,extract:false
          }}
        :incomingRow;
      const expected=["uid","title","content","site","site_id","able",
        "createtime","UpdateTime"];
      if(!["lo3rwang","lrunes"].includes(scope)||!row||typeof row!=="object"||
        Array.isArray(row)||Object.keys(row).length!==expected.length||
        Object.keys(row).some(k=>!expected.includes(k))||
        !/^[A-Za-z0-9]{8}$/.test(String(row.uid||""))||
        typeof row.title!=="string"||row.title.length>350||
        typeof row.content!=="string"||!row.content.trim()||
        row.content.length>125000||row.site!=="mcp"||
        typeof row.site_id!=="string"||row.site_id.length<3||
        row.site_id.length>150||!row.able||typeof row.able!=="object"||
        Object.keys(row.able as Record<string,unknown>).length!==8||
        ["statics","culture","search","trace","list","keywords","game","extract"].some(k=>(row.able as Record<string,unknown>)[k]!==false)||
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
              :{kind:"rpc",schema:"silver",name:"management_write",
                args:{p_table:table,p_operation:"update",p_values:values,
                  p_filters:[{column:"uid",operator:"eq",value:row.uid},
                    {column:"site_id",operator:"eq",value:row.site_id}]}});
          const updatedCount=update?.count??update?.data?.count;
          if(updatedCount===1)return {data:{count:1},count:1};
          if(updatedCount!==0)throw new Error("Unexpected managed sync update count");
        }
        return executeRequest(trx,controlTarget,"authenticated",claims,{
          kind:"rpc",schema:"silver",name:"management_write",
          args:{p_table:table,p_operation:"insert",p_rows:[row]}
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
      const expected=["kind","scopeid","uid","pr_number","title","content","updated_at"];
      const prNumber=body.pr_number;
      if(!["lo3rwang","lrunes"].includes(scope)||
        Object.keys(body).length!==expected.length||
        Object.keys(body).some(key=>!expected.includes(key))||
        !/^[A-Za-z0-9]{8}$/.test(String(body.uid||""))||
        !Number.isInteger(prNumber)||Number(prNumber)<1||Number(prNumber)>9999999||
        typeof body.title!=="string"||!body.title.trim()||body.title.length>350||
        typeof body.content!=="string"||!body.content.trim()||body.content.length>125000||
        typeof body.updated_at!=="string"||!body.updated_at)
        return json({error:{message:"Invalid PR update payload"}},400);
      const uid=String(body.uid);
      const table="silver."+scope+"_galaxy";
      const tableRef=sql.ref(table);
      const db=await databaseForTarget(controlTarget);
      const result=await db.transaction().execute(async trx=>{
        await sql`set local role authenticated`.execute(trx);
        await sql`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.sub',${String(claims.sub||"")},true)`.execute(trx);
        await sql`select set_config('request.jwt.claim.role','authenticated',true)`.execute(trx);
        const existing=await sql<{uid:string;title:string;site:string}>`
          select uid,title,site from ${tableRef} where uid=${uid} limit 1`.execute(trx);
        const row=existing.rows[0];
        if(!row)throw Object.assign(new Error("Scope article not found"),{httpStatus:403});
        if(row.site!=="github")
          throw Object.assign(new Error("Only GitHub PR-origin articles can be updated through this tool"),{httpStatus:403});
        const prMarker=new RegExp("(?:^|[^0-9])PR\\s*#"+Number(prNumber)+"(?:[^0-9]|$)");
        if(!prMarker.test(row.title))
          throw Object.assign(new Error("PR number does not match this article's title"),{httpStatus:403});
        const values={title:body.title,content:body.content,UpdateTime:body.updated_at};
        const updated=await executeRequest(trx,controlTarget,"authenticated",claims,
          scope==="lo3rwang"
            ?{kind:"query",schema:"silver",table:scope+"_galaxy",operation:"update",
              values,filters:[{column:"uid",operator:"eq",value:uid}]}
            :{kind:"rpc",schema:"silver",name:"management_write",
              args:{p_table:table,p_operation:"update",p_values:values,
                p_filters:[{column:"uid",operator:"eq",value:uid}]}});
        const count=updated?.count??updated?.data?.count;
        if(count!==1)throw new Error("Managed PR update affected an unexpected number of rows");
        return {data:{count:1},count:1};

      });
      return json(result);
    }
    if(body.kind==="rpc"&&body.schema==="silver"&&body.name==="check_backup_readiness"){
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
          loc:["id","theme","statistics_able","culture_able"],
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
      return json({data:{
        provider:routing.provider,
        primary_id:routing.primaryId,
        primary_control:routing.primaryControl,
        backup_id:routing.backupId,
        backup_provider:routing.backupProvider,
        mode:routing.mode
      }});
    }
    if(body.kind==="rpc"&&body.schema==="silver"&&body.name==="save_database_target"){
      if(!body.args||typeof body.args!=="object"||Array.isArray(body.args)||Object.keys(body.args).some(key=>key!=="p_target"))
        return json({error:{message:"Invalid target settings"}},400);
      const result=await saveDatabaseTarget((body.args as Record<string,any>).p_target,role,claims);
      return json({data:result,count:null});
    }
    // The old admin RPCs must not pretend to switch an immutable, deployed route.
    if(body.kind==="rpc"&&body.schema==="silver"&&
       (body.name==="set_database_target"||body.name==="set_database_routing"))
      return json({error:{message:"Database routing is set in app/loc/providers/routing-config.mjs and requires deployment"}},409);

    let target=controlTarget as Record<string,any>;
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
    // configured and supabase always execute on the trusted Supabase control target.
    // No per-request database_targets lookup, even for RPCs and authenticated writes.
    if(target.provider==="neon"&&(body.kind!=="query"||body.operation!=="select"))
      return json({error:{message:"Neon LOC mirror is read-only"}},403);
    // PostgreSQL mirrors enforce per-row access through RLS, not table-name
    // lists. This older Supabase-hosted Edge transport remains optional; the
    // independent Neon primary/backup never requires it.
    if(target.provider==="neon"&&(body.schema!=="silver"||typeof body.table!=="string"))
      return json({error:{message:"Neon LOC mirror table is not enabled"}},403);
    if(target.provider==="neon"&&role==="anon"){role="anonymous";claims.role=role;}
    // Non-PostgreSQL engines have no equivalent to PostgreSQL RLS yet.
    // Enforce the same small public reference whitelist BEFORE opening a
    // database connection; executeRequest repeats the gate defensively.
    if(target.engine!=="postgres")assertCrossEnginePublicRead(body);
    const db=isSupabaseControlTarget(target)
      ?await databaseForTarget(controlTarget)
      :await databaseForTarget(target,{profileLookup:profileForTarget});
    const result=await db.transaction().execute(trx=>executeRequest(trx,target,role,claims,body));
    return json(result,200,result.count===null?{}:{"content-range":`0-${Math.max(0,(Array.isArray(result.data)?result.data.length:0)-1)}/${result.count}`});
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const transientConnectionFailure = code === "53300" || code.startsWith("08") || /connection (?:terminated|timeout)|remaining connection slots/i.test(message);
    const status = (error && typeof error === 'object' && 'httpStatus' in error) ? Number(error.httpStatus) : resolvingTarget || transientConnectionFailure ? 503 : isKyselyClientError(error) ? 400 : 500;
    if (status >= 500) console.error("[loc-kysely] Database request failed", error);
    const responseMessage = status === 400 || status === 403 || status === 409 ? message : resolvingTarget ? "Selected database target is unavailable" : status === 503 ? "Database is temporarily unavailable" : "Database request failed";
    return json({ error: { message: responseMessage, code: code || undefined } }, status);
  }
});
