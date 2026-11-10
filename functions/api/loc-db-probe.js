// Manual LOC SQL connection verification. Invoked only by the LOC Auth Worker
// after its durable, source-wide three-attempt-per-hour quota reservation.
// No arbitrary SQL, no provider discovery, no fallback dialect, no retries.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {verifySelectedSqlType} from '../../app/loc/providers/sql-type-verification.mjs';

const HEADER={'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','x-content-type-options':'nosniff'};
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const TICKET=/^[0-9a-f-]{36}$/;
const reply=(payload,status=200)=>new Response(JSON.stringify(payload),{
 status,headers:HEADER
});

function causeCodes(error){
 const codes=[];
 for(let e=error,depth=0;e&&depth<5;depth++,e=e.cause){
  const value=String(e.code||e.number||e.errno||'');
  if(value)codes.push(value.toUpperCase());
 }
 return codes;
}
export function sqlProbeFailureReason(error){
 if(error?.code==='SQL_TYPE_MISMATCH')return 'TYPE_MISMATCH';
 const codes=causeCodes(error);
 // A single rejected authentication immediately stops further probes.
 if(codes.some(code=>[
  '28P01','28000','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR',
  '1045','1044','ELOGIN','18456','18452'
 ].includes(code)))return 'AUTH_FAILED';
 if(codes.some(code=>[
  '53300','53400','57P03','ER_CON_COUNT_ERROR','1040',
  '10928','10929','40501','40197','40613'
 ].includes(code)))return 'CAPACITY';
 if(codes.some(code=>[
  'ETIMEDOUT','ETIMEOUT','ESOCKET','ESOCKETHANGUP'
 ].includes(code))||error?.name==='TimeoutError')return 'TIMEOUT';
 return 'DATABASE_UNAVAILABLE';
}
export async function onRequest({request,env}){
 if(request.method!=='POST')return reply({ok:false,reason:'METHOD_NOT_ALLOWED'},405);
 // This is a backend-only route, never an OAuth or user-facing SQL endpoint.
 if(new URL(request.url).hostname!=='loc.lo3rwang.cc')
  return reply({ok:false,reason:'NOT_FOUND'},404);
 const expected=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
 const token=String(request.headers.get('x-loc-service-token')||'');
 if(expected.length<32||token.length!==expected.length)
  return reply({ok:false,reason:'BACKEND_REQUIRED'},403);
 let diff=0;
 for(let i=0;i<expected.length;i++)
  diff|=expected.charCodeAt(i)^token.charCodeAt(i);
 if(diff!==0)return reply({ok:false,reason:'BACKEND_REQUIRED'},403);
 let body;
 try{
  const raw=await request.text();
  if(raw.length>280)throw Error('Invalid probe data');
  body=JSON.parse(raw);
 }catch{return reply({ok:false,reason:'INVALID_REQUEST'},400)}
 if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).some(k=>!['id','ticket'].includes(k))||
   !ID.test(String(body.id||''))||!TICKET.test(String(body.ticket||'')))
  return reply({ok:false,reason:'INVALID_REQUEST'},400);
 let selected=null;
 try{
  selected=await directMcpKysely(env,body.id,{probeTicket:body.ticket});
  // One query, using the SQL Type selected and saved in LOC Auth.
  // A successful login is the only authentication proof: no user enumeration.
  const verified=await verifySelectedSqlType(selected.db,selected.engine);
  return reply({ok:true,typeVerified:true,credentialsVerified:true,
   engine:verified.engine,version:verified.version});
 }catch(error){
  return reply({ok:false,typeVerified:false,credentialsVerified:false,
   reason:sqlProbeFailureReason(error)});
 }finally{
  if(selected)await selected.db.destroy().catch(()=>{});
 }
}
