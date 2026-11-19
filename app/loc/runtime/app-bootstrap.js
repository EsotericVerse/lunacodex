'use client';

import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {invalidatePublicScopeMetadata,selectScopeRegistry} from '../scope/scope-data';
import {selectThemeRegistry,themeUiId} from '../preferences/theme-data';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';

// Only page presentation metadata belongs to the shell Bootstrap.
// Page Blocks belong to their actual display component, never to navigation,
// Theme, title or routing; unrelated consumers must not trigger an SQL read.
const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const PAGE_NAME=/^[a-z0-9_-]+$/;
export function invalidateAppBootstrapMetadata(){
  invalidatePublicScopeMetadata();
}

export function appBootstrapKey(scopeId,pageName='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const page=String(pageName||'index').trim().toLowerCase();
  return ['app-bootstrap',SCOPE_ID.test(id)?id:'',PAGE_NAME.test(page)?page:'index'];
}

// No Bootstrap RPC or page-content query. Public layout metadata is independent
// from the content reader and from editing / account authorization.
export async function selectAppBootstrap(scopeId,pageName='index',{configHint=null}={}){
  const [,id,page]=appBootstrapKey(scopeId,pageName);
  // Local Scope is a native IndexedDB workspace, not a cloud Registry or
  // Blocks table. Do not issue even an attempted cloud metadata read.
  if(id==='local')return {
    scope_id:id,page_name:page,config:null,registry:[],
    page_copy:[],theme_list:[],themes:[]
  };
  const [registry,themeNames,config]=await Promise.all([
    id==='local'?Promise.resolve([]):selectScopeRegistry(),
    id==='local'?Promise.resolve([]):selectThemeRegistry(),
    id&&id!=='admin'
      ?Promise.resolve(configHint||SCOPE_ROUTE_INDEX.find(row=>row.scope_id===id)?.config||null)
      :Promise.resolve(null)
  ]);
  return {
    scope_id:id,page_name:page,config,registry,page_copy:[],
    theme_list:themeNames.map(row=>({
      theme_id:themeUiId(row.theme_id),theme_name:row.theme_name,
      theme_order:row.theme_order
    })),themes:[]
  };
}

export function appBootstrapPageCopy(data,scopeId){
  const id=String(scopeId||'').trim().toLowerCase();
  const row=(data?.page_copy||[]).find(item=>String(item?.scope_id||'').trim().toLowerCase()===id);
  return row?{scope_id:id,Title_TW:String(row.Title_TW||'').trim(),Desc_TW:String(row.Desc_TW||'').trim()}:null;
}

export function useAppBootstrap(scopeId,pageName='index',{enabled=true}={}){
  const key=appBootstrapKey(scopeId,pageName);
  // The public bootstrap is non-authorizing metadata. All mounted shell,
  // theme and page readers share its completed snapshot until the last one
  // leaves; protected queries and Auth never opt into this policy.
  return useAsyncResource(key,()=>selectAppBootstrap(scopeId,pageName),
    {enabled,shareResult:true});
}
