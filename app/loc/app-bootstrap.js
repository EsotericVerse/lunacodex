'use client';

import {useAsyncResource} from '../../zenstack/client-queries';
import {invalidatePublicScopeMetadata,selectScopeBlocks,selectScopeConfig,selectScopeRegistry} from './scope-data';
import {selectThemeRegistry,themeUiId} from './theme-data';
import {SCOPE_ROUTE_INDEX} from '../modular/scope-route-index.js';

// Shared public site snapshot (Registry/Theme/page copy) is fetched once per
// client runtime. Each Scope page fetches only its own config and page blocks.
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

// No bootstrap RPC and no ISR dependency. A public entry reads the Scope
// configuration and the requested Blocks once; registry and themes are
// non-authorizing presentation metadata.
export async function selectAppBootstrap(scopeId,pageName='index',{configHint=null}={}){
  const [,id,page]=appBootstrapKey(scopeId,pageName);
  const [registry,themes,config,blocks]=await Promise.all([
    id==='local'?Promise.resolve([]):selectScopeRegistry(),
    id==='local'?Promise.resolve([]):selectThemeRegistry(),
    id&&id!=='admin'
      ?(configHint?Promise.resolve(configHint):page==='index'
        ?Promise.resolve(SCOPE_ROUTE_INDEX.find(row=>row.scope_id===id)?.config||null)
        :selectScopeConfig(id))
      :Promise.resolve(null),
    id&&id!=='admin'?selectScopeBlocks(id,page):Promise.resolve([])
  ]);
  return {
    scope_id:id,page_name:page,config,blocks,registry,page_copy:[],
    theme_list:themes.map(row=>({
      theme_id:themeUiId(row.theme_id),theme_name:row.theme_name,
      theme_order:row.theme_order
    })),themes
  };
}

export function appBootstrapPageCopy(data,scopeId){
  const id=String(scopeId||'').trim().toLowerCase();
  const row=(data?.page_copy||[]).find(item=>String(item?.scope_id||'').trim().toLowerCase()===id);
  return row?{scope_id:id,Title_TW:String(row.Title_TW||'').trim(),Desc_TW:String(row.Desc_TW||'').trim()}:null;
}

export function useAppBootstrap(scopeId,pageName='index',{enabled=true}={}){
  const key=appBootstrapKey(scopeId,pageName);
  return useAsyncResource(key,()=>selectAppBootstrap(scopeId,pageName),{enabled});
}
