'use client';

import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {invalidatePublicScopeMetadata,selectScopeRegistry,selectScopeBlocks} from '../scope/scope-data';
import {selectThemeRegistry,themeUiId} from '../preferences/theme-data';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';

// Shared public site snapshot (Registry/Theme metadata) is fetched once per
// client runtime. Mutable page copy and authored Blocks are read from R2/SQL.
// Shared ZenStack client queries deduplicate consumers of the same (scopeId, pageName) key.
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

// Registry and theme metadata remain static; authored presentation Blocks
// use the existing page-exact live reader. No ISR or Auth is required.
export async function selectAppBootstrap(scopeId,pageName='index',{configHint=null}={}){
  const [,id,page]=appBootstrapKey(scopeId,pageName);
  // Local Scope is a native IndexedDB workspace, not a cloud Registry or
  // Blocks table. Do not issue even an attempted cloud metadata read.
  if(id==='local')return {
    scope_id:id,page_name:page,config:null,blocks:[],registry:[],
    theme_list:[],themes:[]
  };
  const [registry,themeNames,config,blocks]=await Promise.all([
    id==='local'?Promise.resolve([]):selectScopeRegistry(),
    id==='local'?Promise.resolve([]):selectThemeRegistry(),
    id&&id!=='admin'
      ?Promise.resolve(configHint||SCOPE_ROUTE_INDEX.find(row=>
        row.scope_id===id&&row.active!==false)?.config||null)
      :Promise.resolve(null),
    id&&id!=='admin'
      ?selectScopeBlocks(id,page)
      :Promise.resolve([])
  ]);
  return {
    scope_id:id,page_name:page,config,blocks,registry,
    theme_list:themeNames.map(row=>({
      theme_id:themeUiId(row.theme_id),theme_name:row.theme_name,
      theme_order:row.theme_order
    })),themes:[]
  };
}

export function useAppBootstrap(scopeId,pageName='index',{enabled=true}={}){
  const key=appBootstrapKey(scopeId,pageName);
  // The public bootstrap is non-authorizing metadata. All mounted shell,
  // theme and page readers share its completed snapshot until the last one
  // leaves; protected queries and Auth never opt into this policy.
  return useAsyncResource(key,()=>selectAppBootstrap(scopeId,pageName),
    {enabled,shareResult:true});
}
