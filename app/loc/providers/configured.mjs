// Website data, presentation and public reads never depend on an Auth service.
// A protected write sends the opaque Better Auth cookie to the website's
// business API; that API validates identity, then queries api.manage for roles.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createKyselyPublicClient} from './kysely-browser.mjs';
import {transientReadSignal} from '../../../zenstack/transient-read-epoch.mjs';

const AUTH='https://auth.lo3rwang.cc';
const PERSONAL=new Set(['api.loc_user','api.user_settings','api.user_records']);
// Only confirmed read actions participate in management-page cancellation.
// Mutations/import writes are never aborted by a navigation reset.
const READ_ACTIONS=new Set([
  'read_group_members','read_loc_source_hierarchy','read_scope_registry_admin',
  'find_galaxy_duplicates','keyword_pattern_statistics','suggest_search_patterns',
  'media_anchor_candidates','anchor_import_page','import_site_presence'
]);
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
    // The same authenticated endpoint serves reads and writes. Only known
    // reads can inherit the active page's abort signal; never cancel a write.
    const readOnly=kind==='personal-read'||
      (kind==='managed-action'&&READ_ACTIONS.has(String(fields.name||'')));
    const signal=readOnly
      ?AbortSignal.any([transientReadSignal(),AbortSignal.timeout(30000)])
      :AbortSignal.timeout(30000);
    // Cookies still authenticate every request; no extra Auth round-trip.
    const response=await fetchImpl('/api/loc-native',{
      method:'POST',
      credentials:'include',
      cache:'no-store',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({kind,scopeid,...fields}),
      signal
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
    // Label the envelope with the Scope this action belongs to. Authorization
    // still comes from the signed claim, and each handler revalidates its own
    // args.p_scope_id; naming the Scope here never widens what it may touch.
    const result=await operation('managed-action',String(args?.p_scope_id||''),{name,args});
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
    return operation('short-import',scopeid,{batch});
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
