// LOC Auth-only registry lookup. LOC Auth owns identity and authorization;
// the LOC Pages application supplies the existing database facts via Kysely.
// MCP is not involved, and no arbitrary SQL or database table is exposed.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {registryRelationForEngine} from '../../app/loc/providers/live-database-target.mjs';

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
  let stage='driver';
  try{
    const selected=await directMcpKysely(env);
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
    const code=String(error?.code||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,40);
    console.error('[LOC Auth registry lookup]',{stage,code:code||'UNKNOWN'});
    return respond({error:'LOC registry read unavailable',stage},503);
  }
}
