'use client';


import {DB_QUERY_BATCH_SIZE,selectRows} from './db-query.mjs';
import {scopeConfigColumns,scopeFeatureEnabled} from './scope-config-fields.mjs';
import {dbPublicClient} from './db-client.mjs';
import {Capacitor} from '@capacitor/core';
import {SCOPE_ROUTE_INDEX} from '../modular/scope-route-index.js';
import {PUBLISHED_SITE_BOOTSTRAP} from '../modular/published-site-bootstrap.js';
import {loadPublishedBlocks} from '../modular/published-blocks/index.js';

// Public page copy (Title_TW/Desc_TW) now travels inside the shared
// app-bootstrap request (see app/loc/app-bootstrap.js); there is no
// standalone per-page RPC call for it any more.
// silver.manage 為最高權限與 Registry 主表，silver.loc 為 LOC 本身設定；管理授權由
// email/manage_role/galaxy_table/anchor_table/birthday 欄位提供，
// 公開查詢絕不包含 email；權限驗證由受保護的管理 RPC 提供。
// 以下只對非機密欄位使用 PostgREST alias，
// buildScopeData/scopeDataFromManageRows 完全不需要改動。
export const MANAGE_TABLE='silver.manage';
const MANAGE_COLUMNS='id,role:manage_role,galaxy:galaxy_table,anchor:anchor_table,birthday';
const MANAGE_ROLE_COLUMN='manage_role';

const SCOPE_ID_PATTERN=/^[a-z][a-z0-9]{0,14}$/;
const TABLE_TOKEN_PATTERN=/^[a-z][a-z0-9_]*$/;

// No remote ISR address is permitted, including when an old build
// environment variable still contains one.
export function locPublicIsrUrl(path){return path;}

function requiredToken(value,label){
  const token=String(value||'').trim()||label;
  if(!TABLE_TOKEN_PATTERN.test(token))throw new Error('silver.loc '+label+' 設定無效');
  return token;
}

function buildScopeData(row,id){
  const galaxySuffix=requiredToken(row?.galaxy,'galaxy');
  const anchorSuffix=requiredToken(row?.anchor,'anchor');
  const galaxy=`silver.${id}_${galaxySuffix}`;
  return {
    id,
    config:`silver.${id}`,
    role:String(row?.role||'').trim(),
    birthday:String(row?.birthday||'').slice(0,10)||null,
    galaxy,
    // One physical store for Time, Trace, Keywords and Media.
    anchor:`silver.${id}_${anchorSuffix}`,
    galaxyMedia:galaxy+'_media',
    // Compatibility aliases are resolved only by the DB adapter.
    time:`silver.${id}_${anchorSuffix}`,
    keywords:`silver.${id}_keywords`,
    blocks:`silver.${id}_blocks`
  };
}

export function defaultScopeData(scopeId){
  const id=String(scopeId||'').trim();
  return SCOPE_ID_PATTERN.test(id)?buildScopeData({},id):null;
}

export function scopeDataFromManageRows(rows=[]){
  const scopes=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const id=String(row?.id||'').trim();
    if(!SCOPE_ID_PATTERN.test(id))continue;
    const next=buildScopeData(row,id);
    const current=scopes.get(id);
    if(current&&(current.galaxy!==next.galaxy||current.anchor!==next.anchor)){
      throw new Error('silver.loc Scope '+id+' 的 galaxy/anchor 設定不一致');
    }
    scopes.set(id,current
      ?{...current,role:current.role==='admin'||next.role==='admin'?'admin':next.role,birthday:current.birthday||next.birthday}
      :next);
  }
  return [...scopes.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

// Public Scope-to-table metadata is stable during ordinary browsing. Share the
// same completed request across Culture/Confluence readers and across route
// changes. This is NOT an authorization cache; writes still enforce RLS.
let managedScopesRequest=null;
export function selectManagedScopes(){
  if(managedScopesRequest)return managedScopesRequest;
  managedScopesRequest=selectRows(MANAGE_TABLE,{
    columns:MANAGE_COLUMNS,
    filters:[{column:MANAGE_ROLE_COLUMN,operator:'in',value:['scope']}],
    orders:[{column:'id',ascending:true}],
    limit:DB_QUERY_BATCH_SIZE,
    offset:0
  }).then(({rows})=>scopeDataFromManageRows(rows)).catch(error=>{
    managedScopesRequest=null;
    throw error;
  });
  return managedScopesRequest;
}

function normalizeRegistryRow(row){
  const id=String(row.scope_id||'').trim();
  return {
    scope_id:id,
    display_name:String(row.display_name||'').trim(),
    // Admin is an operations node, never an article Scope. The bootstrap RPC
    // currently reports it as a Scope even though silver.loc marks it system.
    scope_kind:id==='admin'?'system':String(row.scope_kind||'').trim(),
    domain:String(row.domain||'').trim()||null,
    directory:String(row.directory||'').trim()||null,
    parent_scope_id:String(row.parent_scope_id||'').trim()||null,
    active:row.active!==false,
    sort_order:Number(row.sort_order)||0
  };
}

// silver.scope_registry 已停用：registry 列表改由 read_app_bootstrap RPC
// 動態組出（來源是 silver.loc 的指向欄位 + 各節點自己的 display_name），
// 回傳格式跟舊版 scope_registry 查詢完全相同，呼叫端不需要改動。
// One public site snapshot per client runtime (including concurrent mounts).
// Registry, theme catalogue and page-copy are shared by all Scope pages.
let publicSiteBootstrapRequest=null;
let editedPublicMetadata=false;
// Theme writes invalidate only the site snapshot, not Scope metadata or
// runtime Registry caches. Ordinary Guest navigation is unaffected.
export function invalidatePublicThemeSnapshot(){
  editedPublicMetadata=true;
  publicSiteBootstrapRequest=null;
}
// Only explicit admin metadata refreshes invalidate the public client snapshot.
// Guest navigation shares the same promise and never preflights authorization.
export function invalidatePublicScopeMetadata(){
  editedPublicMetadata=true;
  managedScopesRequest=null;
  publicSiteBootstrapRequest=null;
  scopeConfigInFlight.clear();
  scopeBlocksRequests.clear();
  if(typeof window!=='undefined'){
    window.dispatchEvent(new Event('loc-public-scope-metadata-changed'));
  }
}
// The caller's SWR invalidation and direct database reads provide freshness;
// no API request or background ISR cache invalidation is necessary.
export async function revalidateServerMetadata(){return false;}
export function selectPublicSiteBootstrap(){
  if(publicSiteBootstrapRequest)return publicSiteBootstrapRequest;
  // Normal visitor path is a JS module, no fetch, JSON parsing, Worker or SQL.
  // After an authorized editor change, the current editor sees live data until publication.
  publicSiteBootstrapRequest=(editedPublicMetadata
    ?dbPublicClient.schema('silver').rpc('read_app_bootstrap',{p_scope_id:'loc',p_page_name:'index'})
      .then(({data,error})=>{if(error)throw error;return {...(data||{}),blocks:[]};})
    :Promise.resolve({...PUBLISHED_SITE_BOOTSTRAP,
      config:SCOPE_ROUTE_INDEX.find(row=>row.scope_id==='loc')?.config||null}
    )).catch(error=>{publicSiteBootstrapRequest=null;throw error;});
  return publicSiteBootstrapRequest;
}

async function fetchRegistryRows(){
  const data=await selectPublicSiteBootstrap();
  return Array.isArray(data.registry)?data.registry:[];
}

export async function selectScopeRegistry({parentScopeId=null,scopeKind=null}={}){
  const rows=await fetchRegistryRows();
  return rows
    .filter(row=>row?.active!==false)
    .map(normalizeRegistryRow)
    .filter(row=>!parentScopeId||row.parent_scope_id===String(parentScopeId).trim())
    .filter(row=>!scopeKind||row.scope_kind===String(scopeKind).trim())
    .sort((a,b)=>a.sort_order-b.sort_order||a.scope_id.localeCompare(b.scope_id));
}

// LOC's public search registry: registry membership and each tree's search_able
// are independent of an article's searchable flag.
export async function selectLocSearchScopes(){
  // LOC Group membership is owned by silver.manage, not by front-end routes.
  const {data,error}=await dbPublicClient.schema('silver').rpc('scope_group',{
    p_group_id:'loc',p_type:'search'
  });
  if(error)throw error;
  const members=new Set((data?.scopes||[]).map(row=>String(row.scope_id||'').trim()));
  const registry=await selectScopeRegistry({scopeKind:'scope'});
  const scopes=await Promise.all(registry
    .filter(row=>row.active&&members.has(row.scope_id))
    .map(async row=>{
      const config=await selectScopeConfig(row.scope_id);
      if(!config||!scopeFeatureEnabled(config,'search_able'))return null;
      const scope=defaultScopeData(row.scope_id);
      return scope?{...scope,display_name:String(config.display_name||row.display_name||row.scope_id).trim()}:null;
    }));
  return scopes.filter(Boolean);
}

// Group membership is resolved by silver.manage inside scope_group. Keep the
// caller's exact Culture/Trace range, pagination and visibility queries intact.
const groupMembershipRequests=new Map();
export function selectScopeGroupMemberIds(groupId='loc',type='culture'){
  const key=groupId+':'+type;
  if(groupMembershipRequests.has(key))return groupMembershipRequests.get(key);
  const request=dbPublicClient.schema('silver').rpc('scope_group',{
    p_group_id:groupId,p_type:type
  }).then(({data,error})=>{
    if(error)throw error;
    if(!Array.isArray(data?.scopes))throw new Error('Invalid Scope Group membership');
    return new Set(data.scopes.map(row=>String(row.scope_id||'').trim()).filter(Boolean));
  }).catch(error=>{groupMembershipRequests.delete(key);throw error;});
  groupMembershipRequests.set(key,request);
  return request;
}

export async function selectScopeRegistryEntry(scopeId){
  const id=String(scopeId||'').trim().toLowerCase();
  if(!SCOPE_ID_PATTERN.test(id))return null;
  const rows=await fetchRegistryRows();
  const row=rows.find(item=>String(item?.scope_id||'').trim()===id&&item?.active!==false);
  return row?normalizeRegistryRow(row):null;
}

export async function selectScopeGroupChildren(scopeId='loc'){
  const rows=await selectScopeRegistry({parentScopeId:scopeId});
  return Promise.all(rows.map(async row=>{
    if(row.scope_kind!=='scope')return row;
    try{
      const config=await selectScopeConfig(row.scope_id);
      return {
        ...row,
        display_name:String(config?.display_name||row.display_name||row.scope_id).trim(),
        search_intro:String(config?.search_intro||'').trim(),
        search_aliases:Array.isArray(config?.search_aliases)?config.search_aliases:[]
      };
    }catch{
      return row;
    }
  }));
}

export async function selectManagedScope(scopeId){
  const id=String(scopeId||'').trim();
  if(!SCOPE_ID_PATTERN.test(id))throw new Error('Scope ID 無效');
  // Reuse the identical public metadata snapshot instead of SELECT silver.loc
  // once more for every individual Scope. Never use this as a permission check.
  const scopes=await selectManagedScopes();
  return scopes.find(scope=>scope.id===id)||null;
}


// One per-session public metadata request, read only when its feature opens.
// Cloudflare OpenNext/R2 (or Vercel backup) provides cross-user 14-day ISR.
// Authorized metadata writes explicitly clear these per-session snapshots.
const scopeConfigInFlight=new Map();
export function selectScopeConfig(scopeId){
  const scope=defaultScopeData(scopeId);
  if(!scope)return Promise.resolve(null);
  const existing=scopeConfigInFlight.get(scope.id);
  if(existing)return existing;
  // The published route entry also holds its public Config, one shared JS source.
  const live=()=>selectRows(scope.config,{
    columns:scopeConfigColumns(scope.id),
    filters:[{column:'id',operator:'eq',value:scope.id}],limit:1,offset:0
  }).then(({rows})=>rows[0]||null);
  const request=scope.id==='local'||editedPublicMetadata?live():
    Promise.resolve(SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scope.id)?.config||null);
  if(scope.id!=='local')scopeConfigInFlight.set(scope.id,request);
  return request;
}


const scopeBlocksRequests=new Map();
const locallyEditedBlocks=new Set();
export function invalidateScopeBlockPage(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const pageName=String(page||'index').trim().toLowerCase().replace(/^home$/,'index');
  const key=id+':'+pageName;
  scopeBlocksRequests.delete(key);
  locallyEditedBlocks.add(key);
}
// Admin editing must read committed rows, not an immutable build-time JS snapshot.
// Read-after-write calls use this path too, so an RLS no-op cannot appear saved.
export async function selectLiveScopeBlocks(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  if(!SCOPE_ID_PATTERN.test(id))return [];
  // Management page_name is a case-sensitive document key in PostgreSQL.
  // Preserve named keys such as TimeAnchor and GalaxyManage exactly.
  const name=String(page||'index').trim();
  if(!/^[A-Za-z0-9_-]+$/.test(name))throw new Error('Page name 無效');
  const {rows}=await selectRows(`silver.${id}_blocks`,{
    columns:'uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image',
    filters:[{column:'page_name',operator:'eq',value:name}],
    orders:[{column:'block_order',ascending:true}],limit:DB_QUERY_BATCH_SIZE,offset:0
  });
  return rows||[];
}
export async function selectScopeBlocks(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  if(!SCOPE_ID_PATTERN.test(id))return [];
  const requested=String(page||'index').trim().toLowerCase();
  const pageName=requested==='home'?'index':requested;
  if(!/^[a-z0-9_-]+$/.test(pageName))throw new Error('Page name 無效');
  const key=id+':'+pageName;
  if(id!=='local'&&scopeBlocksRequests.has(key))return scopeBlocksRequests.get(key);
  const request=(async()=>{
    if(id!=='local'&&!locallyEditedBlocks.has(key)){
      // Literal dynamic imports are split into immutable, content-hashed JS chunks.
      // Missing published pages are empty; never silently scan the database.
      return loadPublishedBlocks(id,pageName);
    }
    // Device-local data and authorized in-session edits still use the active provider.
    const {rows}=await selectRows(`silver.${id}_blocks`,{
      columns:'uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image',
      filters:[{column:'page_name',operator:'eq',value:pageName}],
      orders:[{column:'block_order',ascending:true}],limit:DB_QUERY_BATCH_SIZE,offset:0
    });
    return rows||[];
  })().catch(error=>{scopeBlocksRequests.delete(key);throw error;});
  if(id!=='local')scopeBlocksRequests.set(key,request);
  return request;
}
