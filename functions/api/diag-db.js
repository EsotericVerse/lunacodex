// TEMPORARY diagnostic endpoint. Attempts the same direct Postgres
// connection as loc-authority-role.js, but returns the REAL error
// (message/code/cause) instead of letting it be masked upstream by
// manage-role.mjs or the auth Worker's generic 5xx handler.
// Remove this file once the /v1/databases 503 is diagnosed.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:HEADERS});

export async function onRequest(context){
  const {request,env}=context;
  if(new URL(request.url).hostname!=='loc.lo3rwang.cc')
    return respond({error:'Not found'},404);
  const configured=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
  const url=new URL(request.url);
  const supplied=String(request.headers.get('x-loc-service-token')||
    url.searchParams.get('token')||'');
  if(configured.length<32||supplied.length!==configured.length)
    return respond({error:'LOC Auth trusted backend required'},403);
  let difference=0;
  for(let i=0;i<configured.length;i++)
    difference|=configured.charCodeAt(i)^supplied.charCodeAt(i);
  if(difference!==0)return respond({error:'LOC Auth trusted backend required'},403);

  const report={
    hasDatabaseUrl:Boolean(env.LOC_DATABASE_URL),
    hasServiceToken:configured.length>=32,
    hasConnectionsJson:Boolean(env.LOC_DB_CONNECTIONS_JSON),
    step:'start'
  };
  try{
    report.step='directMcpKysely';
    const selected=await directMcpKysely(env);
    report.step='query';
    report.engine=selected.engine;
    const rows=await selected.db.selectFrom('api.manage')
      .select(['id']).limit(1).execute();
    report.step='done';
    report.ok=true;
    report.rowCount=rows.length;
    return respond(report);
  }catch(error){
    report.ok=false;
    report.errorName=error?.name||null;
    report.errorCode=error?.code||null;
    report.errorMessage=error?.message||String(error);
    report.errorCause=error?.cause?String(error.cause?.message||error.cause):null;
    report.errorStack=String(error?.stack||'').split('\n').slice(0,6);
    return respond(report,200);
  }
}
