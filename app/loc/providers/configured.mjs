// Website data, presentation and public reads never depend on an Auth service.
// A protected write sends the opaque Better Auth cookie to the website's
// business API; that API validates identity, then queries api.manage for roles.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createKyselyPublicClient} from './kysely-browser.mjs';
import {transientReadSignal} from '../../../packages/zenstack/transient-read-epoch.mjs';
import {invalidateScopedReadCache} from '../../../packages/zenstack/scoped-read-cache.mjs';
import {invalidateCachedReadPrefix} from '../db/semi-dynamic-cache.mjs';

const AUTH='https://auth.lo3rwang.cc';
// Only confirmed read actions participate in management-page cancellation.
// Mutations/import writes are never aborted by a navigation reset.
const READ_ACTIONS=new Set([
  'read_group_members','read_loc_source_hierarchy','read_scope_registry_admin',
  'find_galaxy_duplicates','keyword_pattern_statistics','suggest_search_patterns',
  'media_anchor_candidates','anchor_import_page','import_site_presence','search_galaxy_private'
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
    const readOnly=kind==='managed-action'&&READ_ACTIONS.has(String(fields.name||''));
    const signal=readOnly
      ?AbortSignal.any([transientReadSignal(),AbortSignal.timeout(30000)])
      :AbortSignal.timeout(30000);
    // Cookies still authenticate every request; no extra Auth round-trip.
    let response;
    try{
      response=await fetchImpl('/api/loc-native',{
        method:'POST',credentials:'include',cache:'no-store',
        headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({kind,scopeid,...fields}),signal
      });
    }catch(error){
      // A lost HTTP response does NOT prove the database rolled back. Do not
      // tell the editor to retry blindly or leave an ambiguous stale cache.
      if(kind==='managed-transaction'||kind==='managed-write'||
         kind==='short-import'||kind==='managed-action'&&!readOnly){
        invalidateCachedReadPrefix('scope-aggregate:');
        const uncertain=new Error('儲存回應中斷，提交結果未確認；請重新讀取後再決定是否重試。');
        uncertain.code='LOC_WRITE_RESULT_UNKNOWN';
        throw uncertain;
      }
      throw error;
    }
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw errorFromResponse(result,response);
    // Public Culture/Statistics aggregates are semi-dynamic snapshots, not
    // timed caches. One successful mutation retires affected derived results;
    // no extra COUNT, poll or cache-version SQL is ever triggered here.
    // LOC group aggregates can depend on multiple Scopes, so invalidate the
    // shared numeric family rather than guessing a single physical relation.
    if(kind==='short-import'||kind==='managed-write'||kind==='managed-transaction'||
       (kind==='managed-action'&&!READ_ACTIONS.has(String(fields.name||''))))
      invalidateCachedReadPrefix('scope-aggregate:');
    return result;
  }
  const managedAction=async(name,args={})=>{
    // Label the envelope with the Scope this action belongs to. Authorization
    // still comes from the signed claim, and each handler revalidates its own
    // args.p_scope_id; naming the Scope here never widens what it may touch.
    const result=await operation('managed-action',String(args?.p_scope_id||''),{name,args});
    // After a trusted successful mutation, expire only its physical ZModel
    // Anchor/Blocks relation. Galaxy and management reads never use this cache.
    const scope=String(args?.p_scope_id||'').trim().toLowerCase();
    if(/^[a-z][a-z0-9]{0,14}$/.test(scope)){
      if(name==='save_blocks'||name==='move_scope_block')
        invalidateScopedReadCache('silver.'+(scope==='loc'?'loc_anchor':scope+'_blocks'));
      else if(name==='save_scope_trace_place_names'||
        name==='merge_scope_trace_place_names'||name==='import_shared_keyword_class')
        invalidateScopedReadCache('silver.'+scope+'_anchor');
      else if(name==='provision_scope'||name==='delete_scope'){
        invalidateScopedReadCache('silver.'+scope+'_anchor');
        invalidateScopedReadCache('silver.'+scope+'_blocks');
      }
    }
    return {data:result?.data,error:null};
  };
  const managedTransaction=async operations=>{
    let result;
    try{
      result=await operation('managed-transaction','',{operations});
    }catch(error){
      if(error?.code==='LOC_WRITE_RESULT_UNKNOWN')
        for(const item of operations)invalidateScopedReadCache(item?.p_table);
      throw error;
    }
    // A verified response confirms COMMIT; a rejected batch is not replayed.
    for(const item of operations)invalidateScopedReadCache(item?.p_table);
    return {data:result?.data,error:null};
  };
  const managedWrite=async payload=>{
    const result=await operation('managed-write','',{payload});
    // This is the common successful write boundary for ZModel Anchor/Blocks,
    // including keyword Anchor insert/update/delete and ordinary block writes.
    // Operation() already invalidated derived public numbers, without a SELECT.
    invalidateScopedReadCache(payload?.p_table);
    return {data:result?.data,error:null};
  };
  const authenticatedClient=createKyselyPublicClient({
    role:'authenticated',fetch:fetchImpl,mutate:managedWrite
  });
  const shortImport=async(scopeid,batch)=>{
    if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scopeid||'')))
      throw Error('Invalid LOC import Scope');
    const result=await operation('short-import',scopeid,{batch});
    // The import endpoint can also materialize Time/Place Anchor rows.
    invalidateScopedReadCache('silver.'+scopeid+'_anchor');
    return result;
  };
  const authClient={...authenticatedClient,shortImport,
    schema(name){return {...authenticatedClient.schema(name),
      managedWrite,managedTransaction,managedAction};}
  };
  return {publicClient,authClient,auth:identity.auth,
    configuredPublicClient:publicClient,backupPublicClient:null,
    realtimeClient:null,primarySourceLabel:'主要資料庫連線',
    backupSourceLabel:''};
}
