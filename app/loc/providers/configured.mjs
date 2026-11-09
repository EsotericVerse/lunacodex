// LOC Auth is independent of database transport. In the static Pages build,
// public reads use the database owner's existing HTTPS Data API directly.
// This is not an SQL Gateway or an independently hosted LOC SQL service.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createDirectDataApiClient} from './direct-data-api.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
const DEFAULT_PUBLIC_DATABASE='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLIC_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';
const apiUrl=()=>process.env.NEXT_PUBLIC_LOC_DATA_API_URL||
  (process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_PUBLIC_DATABASE).replace(/\/+$/,'')+'/rest/v1';
const apiKey=()=>process.env.NEXT_PUBLIC_LOC_DATA_API_PUBLIC_KEY||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||DEFAULT_PUBLIC_KEY;

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  url=apiUrl(),publishableKey=apiKey(),
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  const publicClient=createDirectDataApiClient({url,apiKey:publishableKey,role:'anon',fetch:fetchImpl});
  // LOC OAuth JWTs are NOT database credentials. Authenticated SQL writes
  // require the database owner's server-side connection, never a public API key.
  const readOnlyAuthClient=createDirectDataApiClient({url,apiKey:publishableKey,
    role:'authenticated',fetch:fetchImpl});
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
  // Only these two fixed ZModel control relations accept an authenticated
  // UPDATE/DELETE (zenstack/policy-runtime.mjs ADMIN_FIXED_WRITES). Everything
  // else keeps the original "owner Web Server required" refusal from
  // direct-data-api.mjs -- there is no generic write transport here.
  const FIXED_WRITE_TABLES=new Set(['api.manage','silver.loc']);
  const managedWrite=async(payload)=>{
    const table=String(payload?.p_table||'');
    if(!FIXED_WRITE_TABLES.has(table))
      throw Error('This operation requires the database owner Web Server; LOC provides no SQL Gateway');
    const access=String(await identity.getAccessToken()||'');
    if(!access)throw Error('LOC login required');
    // A global self-delegation only ever carries 'global:manage' for the one
    // verified LOC owner (workers/loc-authority/index.mjs exchangeLocDelegation).
    // No Scope id is requested; this is not a per-Scope grant.
    const authorize=await fetchImpl(new URL('/v1/delegation',authorityUrl).href,{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+access,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({audience:'sql',self:true}),
      signal:AbortSignal.timeout(8000)
    });
    if(!authorize.ok){
      const error=new Error('LOC 寫入授權失敗');
      error.status=authorize.status;throw error;
    }
    const delegation=await authorize.json().catch(()=>null);
    const signed=String(delegation?.access_token||'');
    if(signed.split('.').length!==3||!Array.isArray(delegation?.grants)||
      !delegation.grants.includes('global:manage'))
      throw Error('此帳號沒有固定模型的寫入權限');
    const response=await fetchImpl('/api/loc-native',{
      method:'POST',credentials:'omit',cache:'no-store',
      headers:{authorization:'Bearer '+signed,'content-type':'application/json',
        accept:'application/json'},
      body:JSON.stringify({kind:'managed-write',scopeid:'',payload}),
      signal:AbortSignal.timeout(15000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(result?.error?.message||'LOC managed write failed');
      error.status=response.status;throw error;
    }
    return {data:result?.data,error:null};
  };
  const authClient={...readOnlyAuthClient,shortImport,
    schema(name){return {...readOnlyAuthClient.schema(name),managedWrite};}};
  return {publicClient,authClient,auth:identity.auth,
    configuredPublicClient:publicClient,backupPublicClient:null,
    realtimeClient:null,primarySourceLabel:'主要資料庫連線',backupSourceLabel:''};
}
