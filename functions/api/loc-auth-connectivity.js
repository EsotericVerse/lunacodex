// Fixed connectivity check for the explicitly authorized public test table.
// Reuses LOC's existing server-side Kysely pool and Cloudflare LOC_DATABASE_URI.
// No credentials, SQL input, target selection or arbitrary parameters exposed.
import {db_connection} from '../../app/loc/mcp/native-kysely.mjs';

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

export async function testLocAuthConnection(env={},database=db_connection){
 if(!String(env.LOC_DATABASE_URI||'').trim())
  return json({ok:false,stage:'configuration',code:'LOC_DATABASE_URI_MISSING'},503);
 try{
  const connection=await database(env,'loc-main');
  if(connection.engine!=='postgres')return json({ok:false,stage:'driver',code:'NOT_POSTGRES'},503);
  const row=await connection.db.selectFrom('silver.loc_auth')
    .select(['uid','email','scopeid','role']).where('uid','=','001')
    .executeTakeFirst();
  if(!row)return json({ok:false,stage:'query',code:'TEST_ROW_NOT_FOUND'},404);
  return json({ok:true,connection:'postgresql',schema:'silver',table:'loc_auth',data:row});
 }catch(error){
  return json({ok:false,stage:'sql-query',...failureCode(error)},503);
 }
}
// Explicit diagnostic path for the Supabase API key hosted ONLY on Auth Worker.
export async function testSupabaseSecretViaAuthority(env={},fetchImpl=fetch){
 const token=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
 if(token.length<32)return json({ok:false,stage:'configuration',
   code:'PROFILE_SERVICE_TOKEN_MISSING'},503);
 try{
  const response=await fetchImpl('https://auth.lo3rwang.cc/v1/internal/supabase/loc-auth-test',{
   method:'GET',headers:{'x-loc-service-token':token,accept:'application/json'},
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(11000)
  });
  if(!response.ok)return json({ok:false,stage:'authority',code:'AUTHORITY_HTTP_'+response.status},503);
  const data=await response.json();
  const fields=['ok','source','status','code','rowMatched','uidMatched','emailMatched',
    'scopeMatched','roleMatched'];
  const safe=Object.fromEntries(fields.filter(key=>Object.hasOwn(data,key))
    .map(key=>[key,data[key]]));
  return json(safe,data.ok===true?200:503);
 }catch{return json({ok:false,stage:'authority',code:'AUTHORITY_FETCH_FAILED'},503)}
}
export function onRequestGet({request,env}){
 const url=new URL(request.url);
 if(url.searchParams.get('source')==='supabase-api'&&
    [...url.searchParams.keys()].every(k=>k==='source'))
  return testSupabaseSecretViaAuthority(env);
 if([...url.searchParams.keys()].length)
  return json({ok:false,code:'UNSUPPORTED_PROBE'},400);
 return testLocAuthConnection(env)
}
