// Read-only connectivity check for the native PostgreSQL driver.
// Reuses LOC's Kysely/pg.Client transport and Cloudflare LOC_DATABASE_URI.
// No credentials, SQL input, target selection or arbitrary parameters exposed.
import {db_connection,closeLocDatabase,bindLocRequestAbort} from '../../app/loc/mcp/native-kysely.mjs';

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
// Fixed-environment, password-free transport diagnostic. This is NOT a
// public query, database selector, SQL gateway, or database-credential echo.
// It can tell whether the Cloudflare socket or TLS handshake closes before
// pg.Client even sends PostgreSQL startup/authentication bytes.
async function diagnoseFixedPgTransport(env){
 const uri=String(env?.LOC_DATABASE_URI||'');
 if(!uri)return json({ok:false,stage:'configuration'},503);
 let plain=null,tls=null,stage='tcp';
 const started=Date.now(),elapsed={};
 const mark=key=>{elapsed[key]=Date.now()-started;};
 const bound=async work=>Promise.race([
   work,new Promise((_,reject)=>setTimeout(
     ()=>reject(new Error('PROBE_TIMEOUT')),3000))
 ]);
 try{
   const address=new URL(uri);
   const {connect}=await import('cloudflare:sockets');
   plain=connect({hostname:address.hostname,
     port:Number(address.port||5432)},{secureTransport:'starttls'});
   await bound(plain.opened);
   mark('tcp');stage='postgres_ssl_request';
   const writer=plain.writable.getWriter();
   try{await bound(writer.write(new Uint8Array([0,0,0,8,4,210,22,47])));}
   finally{writer.releaseLock();}
   const reader=plain.readable.getReader();
   let response;
   try{response=await bound(reader.read());}
   finally{reader.releaseLock();}
   mark('ssl_response');
   if(response.done||response.value?.[0]!==83)
     return json({ok:false,stage,reply:response.done?'EOF':'NOT_SSL'},503);
   stage='tls';
   tls=plain.startTls();
   await bound(tls.opened);
   mark('tls');
   // Read only PostgreSQL's FIRST authentication frame, without sending a
   // password. This distinguishes a healthy TLS tunnel from a startup
   // protocol failure inside pg.Client. User, database and host stay private.
   stage='postgres_startup';
   const user=decodeURIComponent(address.username);
   const database=decodeURIComponent(address.pathname.slice(1));
   const fields=new TextEncoder().encode(
     'user\0'+user+'\0database\0'+database+
     '\0client_encoding\0UTF8\0application_name\0loc_health_probe\0\0'
   );
   const packet=new Uint8Array(8+fields.length);
   const view=new DataView(packet.buffer);
   view.setUint32(0,packet.length,false);
   view.setUint32(4,196608,false);
   packet.set(fields,8);
   const startupWriter=tls.writable.getWriter();
   try{await bound(startupWriter.write(packet));}
   finally{startupWriter.releaseLock();}
   const startupReader=tls.readable.getReader();
   let authReply;
   try{authReply=await bound(startupReader.read());}
   finally{startupReader.releaseLock();}
   mark('auth_challenge');
   const first=authReply.value?.[0];
   return first===82
     ?json({ok:true,stage:'postgres_auth_challenge',verified:true,elapsed})
     :json({ok:false,stage,reply:authReply.done?'EOF':
       first===69?'PG_ERROR':'OTHER'},503);
 }catch(error){
   const msg=String(error?.message||'').toLowerCase();
   const reason=msg.includes('timeout')?'TIMEOUT':
     /ssl|tls|certificate|handshake/.test(msg)?'TLS':
     /closed|terminated|eof/.test(msg)?'EARLY_CLOSE':
     /connect|network|socket/.test(msg)?'TRANSPORT':'OTHER';
   return json({ok:false,stage,reason,elapsed},503);
 }finally{
   try{await (tls||plain)?.close?.();}catch{}
 }
}
export function onRequestGet({request,env,waitUntil}){
 const option=new URL(request.url).searchParams.get('transport');
 if(option==='diagnose')return diagnoseFixedPgTransport(env);
 return testLocAuthConnection(env,db_connection,{waitUntil,signal:request?.signal});
}
