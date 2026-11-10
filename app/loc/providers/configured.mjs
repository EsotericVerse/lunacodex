// LOC Auth is independent of database transport. In the static Pages build,
// public reads use the database owner's existing HTTPS Data API directly.
// This is not an SQL Gateway or an independently hosted LOC SQL service.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createKyselyPublicClient} from './kysely-browser.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  const publicClient=createKyselyPublicClient({role:'anon',fetch:fetchImpl});
  // LOC OAuth JWTs are NOT database credentials. Authenticated SQL writes
  // require the database owner's server-side connection, never a public API key.
  // Ordinary LOC OAuth is sufficient for the person's own preferences.
  // The owner_id is always resolved from the signed LOC subject in Kysely.
  const PERSONAL=new Set(['api.loc_user','api.user_settings','api.user_records']);
  const nativePersonal=async(kind,payload)=>{
    const access=String(await identity.getAccessToken()||'');
    if(!access)throw Error('LOC login required');
    const authorize=await fetchImpl(new URL('/v1/delegation',authorityUrl).href,{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+access,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({audience:'sql',identity:true}),
      signal:AbortSignal.timeout(8000)
    });
    if(!authorize.ok)throw Error('LOC OAuth personal delegation failed (HTTP '+authorize.status+')');
    const delegation=await authorize.json().catch(()=>null);
    const signed=String(delegation?.access_token||'');
    if(signed.split('.').length!==3)throw Error('Invalid LOC personal delegation');
    const response=await fetchImpl('/api/loc-native',{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+signed,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({kind,scopeid:'',payload}),
      signal:AbortSignal.timeout(30000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(result?.error?.message||
        'LOC personal database operation failed (HTTP '+response.status+')');
      error.status=response.status;throw error;
    }
    return {data:result?.data||{},error:null};
  };
  const privateRead=async query=>{
    const result=await nativePersonal('personal-read',{
      p_table:query.schema+'.'+query.table,p_operation:'select',
      p_columns:query.columns,p_filters:query.filters.map(f=>({
        column:f.column,operator:f.op,value:f.value,negate:f.negate
      })),
      p_orders:query.orders,p_limit:query.rowLimit,p_offset:query.offset,
      p_head:query.head
    });
    const rows=Array.isArray(result.data.data)?result.data.data:[];
    if(query.cardinality==='single'&&rows.length!==1)
      throw Error('Expected exactly one personal record');
    return {data:query.head?null:query.cardinality?rows[0]||null:rows,
      error:null,count:result.data.count??null,status:200};
  };
  const readOnlyAuthClient=createKyselyPublicClient({
    role:'authenticated',fetch:fetchImpl,readPrivate:privateRead,
    mutate:payload=>PERSONAL.has(payload.p_table)
      ?nativePersonal('personal-write',payload).then(result=>({
        data:{count:result.data.count,rows:result.data.data},error:null
      })):managedWrite(payload)});
  // Website-owned Extension bridge obtains a narrow LOC signed delegation.
  // The account token is never passed to the Extension or to PostgREST.
  const shortImport=async(scopeid,batch)=>{
    const scope=String(scopeid||'');
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))
      throw Error('Invalid LOC import Scope');
    const access=String(await identity.getAccessToken()||'');
    if(!access)throw Error('LOC login required');
    const authorize=await fetchImpl(new URL('/v1/delegation',authorityUrl).href,{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+access,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({audience:'sql',scopeid:scope,actions:['write']}),
      signal:AbortSignal.timeout(8000)
    });
    if(!authorize.ok){
      const error=new Error('LOC Scope import authorization denied');
      error.status=authorize.status;throw error;
    }
    const delegation=await authorize.json().catch(()=>null);
    const signed=String(delegation?.access_token||'');
    if(signed.split('.').length!==3)throw Error('Invalid LOC import delegation');
    const response=await fetchImpl('/api/loc-native',{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+signed,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({kind:'short-import',scopeid:scope,batch}),
      signal:AbortSignal.timeout(30000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(result?.error?.message||'LOC import failed');
      error.status=response.status;throw error;
    }
    return result;
  };
  // LOC Auth signs the principal; the trusted LOC Pages backend performs
  // the SQL operation through Kysely. No browser SQL access or MCP dependency.
  const nativeManagement=async(kind,fields)=>{
    const access=String(await identity.getAccessToken()||'');
    if(!access)throw Error('LOC login required');
    const authorize=await fetchImpl(new URL('/v1/delegation',authorityUrl).href,{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+access,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({audience:'sql',self:true}),
      signal:AbortSignal.timeout(8000)
    });
    if(!authorize.ok){
      const error=new Error('LOC 寫入授權失敗（HTTP '+authorize.status+'）');
      error.status=authorize.status;throw error;
    }
    const delegation=await authorize.json().catch(()=>null);
    const signed=String(delegation?.access_token||'');
    if(signed.split('.').length!==3||!Array.isArray(delegation?.grants)||
      !delegation.grants.includes('global:manage'))
      throw Error('LOC Auth 未核發管理寫入權限');
    const response=await fetchImpl('/api/loc-native',{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+signed,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({kind,scopeid:'',...fields}),
      signal:AbortSignal.timeout(30000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(result?.error?.message||'LOC 原生資料庫寫入失敗（HTTP '+response.status+'）');
      error.status=response.status;throw error;
    }
    return {data:result?.data,error:null};
  };
  const managedWrite=payload=>nativeManagement('managed-write',{payload});
  const managedAction=(name,args={})=>nativeManagement('managed-action',{name,args});
  const authClient={...readOnlyAuthClient,shortImport,
    schema(name){return {...readOnlyAuthClient.schema(name),managedWrite,managedAction};}};
  return {publicClient,authClient,auth:identity.auth,
    configuredPublicClient:publicClient,backupPublicClient:null,
    realtimeClient:null,primarySourceLabel:'主要資料庫連線',backupSourceLabel:''};
}
