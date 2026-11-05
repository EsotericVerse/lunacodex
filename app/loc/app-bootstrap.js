'use client';

import {useAsyncResource} from './use-async-resource';
import {invalidatePublicScopeMetadata,invalidatePublicThemeSnapshot,selectPublicSiteBootstrap,selectScopeBlocks,selectScopeConfig,selectScopeRegistry} from './scope-data';
import {selectThemeRegistry,themeUiId} from './theme-data';

// Shared public site snapshot (Registry/Theme/page copy) is fetched once per
// client runtime. Each Scope page fetches only its own config and page blocks.
// SWR deduplicates consumers of the same (scopeId, pageName) key.
const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const PAGE_NAME=/^[a-z0-9_-]+$/;
let bootstrapRpcInstalled=true;
// The public snapshot is long-lived until an explicit Admin Registry refresh.
export function invalidateAppBootstrapMetadata(){
  invalidatePublicScopeMetadata();
}
export function invalidateAppBootstrapThemes(){
  invalidatePublicThemeSnapshot();
}
const missingRpc=error=>['PGRST202','42883'].includes(String(error?.code||''));

export function appBootstrapKey(scopeId,pageName='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const page=String(pageName||'index').trim().toLowerCase();
  return ['app-bootstrap',SCOPE_ID.test(id)?id:'',PAGE_NAME.test(page)?page:'index'];
}

// Fallback while the database function is absent (for example on the backup
// database): the previous per-table reads, kept as the single alternative path.
async function legacyBootstrap(id,page){
  const [registry,themes,config,blocks]=await Promise.all([
    selectScopeRegistry().catch(()=>[]),
    selectThemeRegistry().catch(()=>[]),
    id&&id!=='admin'?selectScopeConfig(id).catch(()=>null):Promise.resolve(null),
    id&&id!=='admin'?selectScopeBlocks(id,page).catch(()=>[]):Promise.resolve([])
  ]);
  return {
    scope_id:id,page_name:page,config,blocks,registry,page_copy:[],
    theme_list:themes.map(row=>({theme_id:row.theme_id,theme_name:row.theme_name,theme_order:row.theme_order})),
    themes
  };
}

export async function selectAppBootstrap(scopeId,pageName='index',{configHint=null}={}){
  const [,id,page]=appBootstrapKey(scopeId,pageName);
  if(id==='local'){
    // Local scope is self-contained; never require a cloud site-bootstrap
    // request for Culture/Statistics/Search/Management on an offline iPhone.
    const [config,blocks]=await Promise.all([
      configHint?Promise.resolve(configHint):selectScopeConfig('local'),
      selectScopeBlocks('local',page)
    ]);
    return {scope_id:id,page_name:page,config,blocks,registry:[],page_copy:[],theme_list:[],themes:[]};
  }
  if(bootstrapRpcInstalled){
    try{
      // Blocks are independent static JSON snapshots, never read from the site
      // metadata RPC or its former ISR endpoint. Start both reads together.
      const [site,[scopeConfig,blocks],publishedThemes]=await Promise.all([
        selectPublicSiteBootstrap(),
        Promise.all([
          id&&id!=='loc'&&id!=='admin'
            ?(configHint?Promise.resolve(configHint):selectScopeConfig(id))
            :Promise.resolve(null),
          id&&id!=='admin'?selectScopeBlocks(id,page):Promise.resolve([])
        ]),
        selectThemeRegistry() // Published JSON, never SELECT silver.loc.theme.
      ]);
      const config=id==='loc'?site.config||null:scopeConfig;
      return {
        scope_id:id,
        page_name:page,
        config,
        blocks,
        registry:Array.isArray(site.registry)?site.registry:[],
        page_copy:Array.isArray(site.page_copy)?site.page_copy:[],
        // Site Themes use numeric IDs in PostgreSQL and theme-N in the UI.
        theme_list:(Array.isArray(site.theme_list)?site.theme_list:[]).map(row=>({...row,theme_id:themeUiId(row.theme_id)})),
        themes:publishedThemes
      };
    }catch(error){
      if(!missingRpc(error))throw error;
      bootstrapRpcInstalled=false;
    }
  }
  return legacyBootstrap(id,page);
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
