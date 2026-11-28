// Website data, presentation and public reads never depend on an Auth service.
// Protected requests send the opaque Better Auth cookie to a LOC Next.js
// route; identity is verified there and business grants come from published JS.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createKyselyPublicClient} from './kysely-browser.mjs';
import {editorTransactionLease,assertEditorTransactionLease,isEditorTransactionCancelled}
  from '../db/editor-transaction-lifecycle.mjs';
import {invalidateScopedReadCache} from '../../../packages/zenstack/scoped-read-cache.mjs';
import {invalidateCachedReadPrefix} from '../db/semi-dynamic-cache.mjs';
import {isManagedReadAction,isManagedWriteAction}
  from '../actions/managed-query-routes.mjs';
import {runLocalLocWrite} from '../actions/local-write.mjs';
import {scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';

const AUTH='https://auth.lo3rwang.cc';
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
  fetchImpl=globalThis.fetch,
  localWrite=runLocalLocWrite
}={}){
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  const publicClient=createKyselyPublicClient({role:'anon',fetch:fetchImpl});
  async function operation(kind,scopeid='',fields={}){
    if(kind==='managed-action'&&isManagedReadAction(fields.name,fields.args))
      throw Error('LOC reads must call their feature-owned Server Action');
    if(kind==='managed-action'&&!isManagedWriteAction(fields.name,fields.args))
      throw Error('Unknown LOC managed write action');
    const bulkEndpoint=kind==='short-import';
    const lease=editorTransactionLease();
    assertEditorTransactionLease(lease);
    let result;
    try{
      if(bulkEndpoint){
        const signal=lease?AbortSignal.any([lease.signal,AbortSignal.timeout(30000)])
          :AbortSignal.timeout(30000);
        const response=await fetchImpl('/api/loc-native',{
          method:'POST',credentials:'include',cache:'no-store',
          headers:{'content-type':'application/json',accept:'application/json'},
          body:JSON.stringify({kind,scopeid,...fields}),signal
        });
        result=await response.json().catch(()=>null);
        if(!response.ok)throw errorFromResponse(result,response);
      }else{
        result=await localWrite({kind,scopeid,...fields});
      }
      assertEditorTransactionLease(lease);
    }catch(error){
      if(isEditorTransactionCancelled(lease)){
        // A Server Action cannot receive the editor's AbortSignal. The SQL
        // write may already have committed, so retire derived reads and report
        // an unconfirmed result instead of claiming the save was rolled back.
        invalidateCachedReadPrefix('scope-aggregate:');
        if(kind==='managed-write'&&typeof fields.payload?.p_table==='string')
          invalidateScopedReadCache(fields.payload.p_table);
        if(kind==='managed-transaction')
          for(const item of fields.operations||[])
            if(typeof item?.p_table==='string')invalidateScopedReadCache(item.p_table);
        if(kind==='managed-action'){
          const scope=String(fields.args?.p_scope_id||'').trim().toLowerCase();
          if(/^[a-z][a-z0-9]{0,14}$/.test(scope)){
            if(['save_blocks','move_scope_block'].includes(fields.name))
              invalidateScopedReadCache('silver.'+(scope==='loc'?scopeTableName(scope,'lucus'):scope+'_blocks'));
            else if(['save_scope_trace_place_names','merge_scope_trace_place_names',
              'import_shared_keyword_class'].includes(fields.name))
              invalidateScopedReadCache('silver.'+scopeTableName(scope,'lucus'));
            else if(['provision_scope','delete_scope'].includes(fields.name)){
              invalidateScopedReadCache('silver.'+scopeTableName(scope,'lucus'));
              invalidateScopedReadCache('silver.'+scope+'_blocks');
            }
          }
        }
        if(kind==='short-import')
          invalidateScopedReadCache('silver.'+scopeTableName(scopeid,'lucus'));
        const stopped=new Error('編輯已取消；已送出的交易結果須重新讀取確認。');
        stopped.code='LOC_EDITOR_CANCELLED';
        throw stopped;
      }
      // A lost HTTP response does NOT prove the database rolled back. Do not
      // tell the editor to retry blindly or leave an ambiguous stale cache.
      if(kind==='managed-transaction'||kind==='managed-write'||
         kind==='short-import'||kind==='managed-action'){
        invalidateCachedReadPrefix('scope-aggregate:');
        const uncertain=new Error('儲存回應中斷，提交結果未確認；請重新讀取後再決定是否重試。');
        uncertain.code='LOC_WRITE_RESULT_UNKNOWN';
        throw uncertain;
      }
      throw error;
    }
    // Public Culture/Statistics aggregates are semi-dynamic snapshots, not
    // timed caches. One successful mutation retires affected derived results;
    // no extra COUNT, poll or cache-version SQL is ever triggered here.
    // LOC group aggregates can depend on multiple Scopes, so invalidate the
    // shared numeric family rather than guessing a single physical relation.
    if(kind==='short-import'||kind==='managed-write'||kind==='managed-transaction'||
       kind==='managed-action')
      invalidateCachedReadPrefix('scope-aggregate:');
    return result;
  }
  const managedAction=async(name,args={})=>{
    if(isManagedReadAction(name,args))
      throw Error('LOC reads must call their feature-owned Server Action');
    if(!isManagedWriteAction(name,args))
      throw Error('Unknown LOC managed write action');
    // Label the envelope with the Scope this action belongs to. Authorization
    // still comes from the signed claim, and each handler revalidates its own
    // args.p_scope_id; naming the Scope here never widens what it may touch.
    const result=await operation('managed-action',
      String(args?.p_scope_id||''),{name,args});
    // After a trusted successful mutation, expire only its physical ZModel
    // Lucus/Blocks relation. Galaxy and management reads never use this cache.
    const scope=String(args?.p_scope_id||'').trim().toLowerCase();
    if(/^[a-z][a-z0-9]{0,14}$/.test(scope)){
      if(name==='save_blocks'||name==='move_scope_block')
        invalidateScopedReadCache('silver.'+(scope==='loc'?scopeTableName(scope,'lucus'):scope+'_blocks'));
      else if(name==='save_scope_trace_place_names'||
        name==='merge_scope_trace_place_names'||name==='import_shared_keyword_class')
        invalidateScopedReadCache('silver.'+scopeTableName(scope,'lucus'));
      else if(name==='provision_scope'||name==='delete_scope'){
        invalidateScopedReadCache('silver.'+scopeTableName(scope,'lucus'));
        invalidateScopedReadCache('silver.'+scope+'_blocks');
      }
    }
    return {data:result?.data??null,error:null,
      homeCacheSync:result?.home_cache_sync};
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
    return {data:result?.data,error:null,
      homeCacheSync:result?.home_cache_sync};
  };
  const managedWrite=async payload=>{
    const result=await operation('managed-write','',{payload});
    // This is the common successful write boundary for ZModel Lucus/Blocks,
    // including keyword Lucus insert/update/delete and ordinary block writes.
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
    // The import endpoint can also materialize Time/Place Lucus rows.
    invalidateScopedReadCache('silver.'+scopeTableName(scopeid,'lucus'));
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
