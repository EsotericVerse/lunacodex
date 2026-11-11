// Website data, presentation and public reads never depend on an Auth service.
// A protected write sends the opaque Better Auth cookie to the website's
// business API; that API validates identity, then queries api.manage for roles.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createKyselyPublicClient} from './kysely-browser.mjs';
import {notifyScopeDataCommitted} from '../scope-statistics-cache.mjs';

const AUTH='https://auth.lo3rwang.cc';
const PERSONAL=new Set(['api.loc_user','api.user_settings','api.user_records']);
function errorFromResponse(result,response){
  const error=new Error(result?.error?.message||
    'LOC data operation failed (HTTP '+response.status+')');
  error.status=response.status;
  if(typeof result?.error?.code==='string')error.code=result.error.code;
  return error;
}
export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=AUTH,
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  const publicClient=createKyselyPublicClient({role:'anon',fetch:fetchImpl});
  async function operation(kind,scopeid='',fields={}){
    // The trusted business endpoint verifies the existing Session and SQL
    // permissions. Do not make a redundant client getSession request before
    // every protected read/write or import batch.
    const response=await fetchImpl('/api/loc-native',{
      method:'POST',
      credentials:'include',
      cache:'no-store',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({kind,scopeid,...fields}),
      signal:AbortSignal.timeout(30000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw errorFromResponse(result,response);
    return result;
  }
  const nativePersonal=async(kind,payload)=>{
    const response=await operation(kind,'',{payload});
    return {data:response?.data||{},error:null};
  };
  const privateRead=async query=>{
    const result=await nativePersonal('personal-read',{
      p_table:query.schema+'.'+query.table,p_operation:'select',
      p_columns:query.columns,
      p_filters:query.filters.map(f=>({
        column:f.column,operator:f.op,value:f.value,negate:f.negate
      })),
      p_orders:query.orders,p_limit:query.rowLimit,
      p_offset:query.offset,p_head:query.head
    });
    const rows=Array.isArray(result.data.data)?result.data.data:[];
    if(query.cardinality==='single'&&rows.length!==1)
      throw Error('Expected exactly one personal record');
    return {data:query.head?null:query.cardinality?rows[0]||null:rows,
      error:null,count:result.data.count??null,status:200};
  };
  const managedAction=async(name,args={})=>{
    const result=await operation('managed-action','',{name,args});
    return {data:result?.data,error:null};
  };
  const managedWrite=async payload=>{
    const result=await operation('managed-write','',{payload});
    return {data:result?.data,error:null};
  };
  const authenticatedClient=createKyselyPublicClient({
    role:'authenticated',fetch:fetchImpl,readPrivate:privateRead,
    mutate:payload=>PERSONAL.has(payload.p_table)
      ?nativePersonal('personal-write',payload).then(result=>({
        data:{count:result.data.count,rows:result.data.data},error:null
      })):managedWrite(payload)
  });
  const shortImport=async(scopeid,batch)=>{
    if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scopeid||'')))
      throw Error('Invalid LOC import Scope');
    const result=await operation('short-import',scopeid,{batch});
    // Browser extension/short imports may return a successful receipt.
    // Only committed, non-duplicate data invalidates this browser's cache.
    if(result?.accepted===true&&result?.articles?.some(row=>
      row&&row.duplicate!==true&&Number(row.appended||0)>0))
      notifyScopeDataCommitted(scopeid,{updatedAt:new Date().toISOString()});
    return result;
  };
  const authClient={...authenticatedClient,shortImport,
    schema(name){return {...authenticatedClient.schema(name),
      managedWrite,managedAction};}
  };
  return {publicClient,authClient,auth:identity.auth,
    configuredPublicClient:publicClient,backupPublicClient:null,
    realtimeClient:null,primarySourceLabel:'主要資料庫連線',
    backupSourceLabel:''};
}
