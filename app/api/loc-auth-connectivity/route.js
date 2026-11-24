// Read-only connectivity check for the native PostgreSQL driver.
// Reuses LOC's Kysely/pg.Client transport and server LOC_DATABASE_URI.
// No credentials, SQL input, target selection or arbitrary parameters exposed.
import {db_connection,closeLocDatabase,bindLocRequestAbort} from '../../loc/mcp/native-kysely.mjs';

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}
});

function failureCode(error){
 let cause=error,code='UNKNOWN',message='';
 for(let i=0;cause&&i<5;i++,cause=cause.cause){
  const name=String(cause.code||'');
  if(code==='UNKNOWN'&&/^[A-Za-z0-9_]{2,40}$/.test(name))code=name;
  message+=' '+String(cause.message||'').toLowerCase();
 }
 const reason=
  /certificate|self.signed|tls|ssl|secure connection|handshake/.test(message)?'TLS':
  /password authentication|scram|sasl|authentication failed/.test(message)?'DB_AUTH':
  /permission denied|insufficient privilege/.test(message)?'DB_PRIVILEGE':
  /relation .* does not exist|undefined table/.test(message)?'DB_RELATION':
  /getaddrinfo|dns|name resolution|enotfound|eai_again/.test(message)?'DNS':
  /network|socket|connect|connection|timeout|timed out|unreachable|refused/.test(message)?'TRANSPORT':
  /unsupported|not implemented|not supported/.test(message)?'RUNTIME_UNSUPPORTED':
  /cannot read|is not a function|undefined|typeerror/.test(message)?'RUNTIME_TYPE':
  /pool|client/.test(message)?'DRIVER_POOL':'UNCLASSIFIED';
 const detail=
  /connection terminated unexpectedly|terminated unexpectedly/.test(message)?'EARLY_CLOSE':
  /connection timeout|timed out|etimedout|timeout exceeded/.test(message)?'TIMEOUT':
  /econnreset|reset by peer|connection reset/.test(message)?'RESET':
  /econnrefused|connection refused/.test(message)?'REFUSED':
  /enetunreach|ehostunreach|network unreachable/.test(message)?'UNREACHABLE':
  /socket|worker|runtime/.test(message)?'SOCKET_RUNTIME':
  'UNSPECIFIED';
 return {code,reason,detail};
}

export async function testLocAuthConnection(env={},database=db_connection,{waitUntil,signal}={}){
 if(!String(env.LOC_DATABASE_URI||'').trim())
  return json({ok:false,stage:'configuration',code:'LOC_DATABASE_URI_MISSING'},503);
 let connection=null;
 let releaseAbort=()=>{};
 try{
  connection=await database(env,'loc-main',{waitUntil});
  releaseAbort=bindLocRequestAbort(connection,signal);
  if(connection.engine!=='postgres')return json({ok:false,stage:'driver',code:'NOT_POSTGRES'},503);
  // A literal SELECT without FROM verifies the native pg/TCP connection.
  // Do not make connection health depend on one Scope table existing or
  // containing articles. No Neon Data API, schema probe or credentials exposed.
  const row=await connection.db.selectNoFrom(eb=>eb.val(1).as('connected'))
    .executeTakeFirstOrThrow();
  if(Number(row?.connected)!==1)
    return json({ok:false,stage:'query',code:'PG_PROBE_INVALID'},503);
  return json({ok:true,connection:'postgresql',driver:'pg',probe:'select_1'});
 }catch(error){
  return json({ok:false,stage:'sql-query',...failureCode(error)},503);
 }finally{
  releaseAbort();
  // The health probe must never leave a socket open after its single SELECT.
  try{await closeLocDatabase(connection);}
  catch(error){console.error('[LOC health SQL cleanup]',{code:String(error?.code||'CLOSE_FAILED').slice(0,64)});}
 }
}
export const runtime='nodejs';
export const dynamic='force-dynamic';

export function GET(request){
 return testLocAuthConnection(process.env,db_connection,{signal:request.signal});
}
