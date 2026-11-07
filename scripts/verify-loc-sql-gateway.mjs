// Zero-mutation PostgreSQL, MySQL and Azure SQL smoke test for the deployed LOC
// Kysely Gateway. This is a client protocol check, never a schema provisioner.
import {pathToFileURL} from 'node:url';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
export function validateGatewayUrl(value){
 let endpoint;
 try{endpoint=new URL(String(value||''));}catch{throw Error('LOC_SQL_GATEWAY_URL is required');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
    endpoint.search||endpoint.hash||endpoint.pathname!=='/v1/sql')
  throw Error('LOC_SQL_GATEWAY_URL must be independent HTTPS /v1/sql');
 return endpoint.href;
}
export function makeReadOnlyProbe(scopeid='lo3rwang'){
 if(!SCOPE.test(scopeid))throw Error('Invalid LOC Scope');
 return {kind:'query',schema:'silver',table:scopeid+'_galaxy',
  operation:'select',columns:['uid','title'],filters:[],or:[],orders:[],
  offset:0,limit:1,target:'configured'};
}
export async function verifyLocSqlGateway({url,scopeid='lo3rwang',
 fetchImpl=globalThis.fetch,timeoutMs=10000}={}){
 const endpoint=validateGatewayUrl(url);
 if(typeof fetchImpl!=='function')throw Error('HTTP fetch is unavailable');
 const probe=makeReadOnlyProbe(scopeid);
 const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',cache:'no-store',
  headers:{accept:'application/json','content-type':'application/json'},
  body:JSON.stringify(probe),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error('LOC SQL public read failed (HTTP '+response.status+
   '); inspect the isolated Gateway log and server-side connection alias');
 let body;
 try{body=await response.json();}catch{throw Error('LOC SQL returned invalid JSON');}
 if(!Array.isArray(body?.data))throw Error('LOC SQL did not return an array of rows');
 if(body.data.length>1||body.data.some(row=>!row||typeof row.uid!=='string'))
  throw Error('LOC SQL public read returned invalid bounded Galaxy projection');
 return {reachable:true,scopeid,rows:body.data.length,readOnly:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 verifyLocSqlGateway({url:process.env.LOC_SQL_GATEWAY_URL,
  scopeid:process.env.LOC_SQL_PROBE_SCOPE||'lo3rwang'})
  .then(result=>{console.log('LOC SQL Gateway readonly probe OK',result);})
  .catch(error=>{console.error(error.message);process.exitCode=1;});
}
