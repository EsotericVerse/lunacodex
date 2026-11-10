// LOC Auth-only registry lookup. LOC Auth owns identity and authorization;
// the LOC Pages application supplies the existing database facts via Kysely.
// MCP is not involved, and no arbitrary SQL or database table is exposed.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {sql} from 'kysely';
import {registryRelationForEngine} from '../../app/loc/providers/live-database-target.mjs';
import {DATABASE_ACCESS_LIST} from '../../app/loc/providers/access.js';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
export async function onRequest(context){
  const {request,env}=context;
  if(request.method!=='GET')return respond({error:'Method not allowed'},405);
  if(new URL(request.url).hostname!=='loc.lo3rwang.cc')
    return respond({error:'Not found'},404);
  const configured=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
  const supplied=String(request.headers.get('x-loc-service-token')||'');
  if(configured.length<32||supplied.length!==configured.length)
    return respond({error:'LOC Auth trusted backend required'},403);
  let difference=0;
  for(let i=0;i<configured.length;i++)
    difference|=configured.charCodeAt(i)^supplied.charCodeAt(i);
  if(difference!==0)return respond({error:'LOC Auth trusted backend required'},403);
  const email=String(new URL(request.url).searchParams.get('email')||'').trim().toLowerCase();
  if(!EMAIL.test(email))return respond({error:'Invalid LOC identity email'},400);
  let stage='driver',selected=null;
  try{
    // Authority roles must come from the fixed main control target, never
    // from a stale local MCP alias or a user-selected external SQL target.
    const primary=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
    if(!primary)throw new Error('Main control target is missing');
    selected=await directMcpKysely(env,primary.target_id);
    if(selected.tableName)
      return respond({error:'LOC registry source unavailable'},503);
    // Main DB uses the chosen Kysely SQL Dialect, never provider detection.
    const registry=registryRelationForEngine(selected.engine);
    stage='registry-query';
    const rows=await selected.db.selectFrom(registry)
      .select(['id','email','manage_role','active'])
      .where(selected.db.fn('lower',['email']),'=',email)
      .limit(64).execute();
    return respond({rows:rows.map(row=>({
      id:row.id,email:row.email,role:row.manage_role,active:row.active
    }))});
  }catch(error){
    // Only a fixed stage reaches the trusted internal caller. Never log
    // connection strings, credentials, SQL parameters, or identity details.
    // Kysely may wrap the SQL driver error in a cause chain.
    // Expose only the SQLSTATE/vendor code, never SQL text or credentials.
    let detail=error,code='UNKNOWN';
    for(let depth=0;detail&&depth<5;depth++,detail=detail.cause){
      const candidate=String(detail.code||'');
      if(/^[A-Za-z0-9_]{2,40}$/.test(candidate)){code=candidate;break;}
    }
    // Diagnostic runs ONLY when a PostgreSQL registry SELECT fails.
    // This is read-only, never SET ROLE, GRANT or a schema mutation.
    const roleProbe={};
    if(stage==='registry-query'&&selected?.engine==='postgres'){
      try{
        const result=await sql`select current_user::text as role_name,
          has_schema_privilege(current_user,'api','USAGE') as schema_usage,
          case when to_regclass('api.manage') is null then false
            else has_table_privilege(current_user,'api.manage','SELECT') end as table_select`
          .execute(selected.db);
        const row=result.rows?.[0]||{};
        const dbRole=String(row.role_name||'');
        roleProbe.db_role=/^[A-Za-z0-9_]{1,63}$/.test(dbRole)?dbRole:'UNKNOWN';
        roleProbe.schema_usage=row.schema_usage===true;
        roleProbe.table_select=row.table_select===true;
      }catch(probeError){
        roleProbe.probe_error=/^[A-Za-z0-9_]{2,40}$/.test(String(probeError?.code||''))
          ?String(probeError.code):'UNKNOWN';
      }
    }
    console.error('[LOC Auth registry lookup]',{stage,code,...roleProbe});
    return respond({error:'LOC registry read unavailable',stage,code,...roleProbe},503);
  }
}
