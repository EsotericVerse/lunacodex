'use client';


import {DB_QUERY_BATCH_SIZE,selectRows} from './db-query.mjs';
import {scopeConfigColumns,scopeFeatureEnabled} from './scope-config-fields.mjs';
import {dbPublicClient,dbConfiguredPublicClient} from './db-client.mjs';
import {Capacitor} from '@capacitor/core';
import {SCOPE_ROUTE_INDEX} from '../modular/scope-route-index.js';
import {PUBLISHED_SITE_BOOTSTRAP} from '../modular/published-site-bootstrap.js';
import {loadPublishedBlocks} from '../modular/published-blocks/index.js';

// Public page copy (Title_TW/Desc_TW) now travels inside the shared
// app-bootstrap request (see app/loc/app-bootstrap.js); there is no
// standalone per-page RPC call for it any more.
// silver.manage owns system authorization and routing; silver.loc is the
// Group Scope List and owns display_name/title_tw/desc_tw/birthday.
// Public birthday metadata is explicitly published, never read from manage.
// 公開查詢絕不包含 email；權限驗證由受保護的管理 RPC 提供。
// 以下只對非機密欄位使用 PostgREST alias，
// buildScopeData/scopeDataFromManageRows 完全不需要改動。
export const MANAGE_TABLE='silver.manage';
// No PostgREST-style "alias:column" renaming here -- the Kysely edge
// function's column validator (kysely-runtime.mjs validateQuery) only
// accepts plain identifiers and rejects anything containing ':' with
// "Invalid selected column". Select the real column names and rename
// them in buildScopeData() below instead.
const MANAGE_COLUMNS='id,manage_role,galaxy_table,anchor_table';
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
  const galaxySuffix=requiredToken(row?.galaxy_table,'galaxy');
  const anchorSuffix=requiredToken(row?.anchor_table,'anchor');
  const galaxy=`silver.${id}_${galaxySuffix}`;
  return {
    id,
    config:`silver.${id}`,
    role:String(row?.manage_role||'').trim(),
    birthday:String(row?.birthday||PUBLISHED_SITE_BOOTSTRAP.scope_birthdays?.[id]||'').slice(0,10)||null,
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
    ?dbPublicClient.schema('silver').publicAction('read_app_bootstrap',{p_scope_id:'loc',p_page_name:'index'})
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

// LOC's public search registry: membership and the Scope-level search switch
// are independent of an article's searchable flag.
export async function selectLocSearchScopes(){
  // LOC Group membership is owned by silver.manage, not by front-end routes.
  const members=await selectScopeGroupMemberIds('loc','search');
  const registry=await selectScopeRegistry({scopeKind:'scope'});
  const scopes=await Promise.all(registry
    .filter(row=>row.active&&members.has(row.scope_id))
    .map(async row=>{
      const config=await selectScopeConfig(row.scope_id);
      if(!config||!scopeFeatureEnabled(config,'search'))return null;
      const scope=defaultScopeData(row.scope_id);
      return scope?{...scope,display_name:String(config.display_name||row.display_name||row.scope_id).trim()}:null;
    }));
  return scopes.filter(Boolean);
}

// Group reads use explicitly published membership on ordinary pages; keep the
// caller's exact Culture/Trace range, pagination and visibility queries intact.
const groupMembershipRequests=new Map();
export function selectScopeGroupMemberIds(groupId='loc',type='culture'){
  const key=groupId+':'+type;
  if(groupMembershipRequests.has(key))return groupMembershipRequests.get(key);
  const request=(async()=>{
    const group=String(groupId||'').trim().toLowerCase();
    if(!SCOPE_ID_PATTERN.test(group)||!['search','culture','trace','statistics'].includes(type))
      throw new Error('Invalid Scope Group request');
    // Public Group membership is published at release time; do not issue
    // two SELECTs against the system routing table for each Group feature.
    const registry=PUBLISHED_SITE_BOOTSTRAP.registry||[];
    if(!registry.some(row=>row.scope_id===group&&row.scope_kind==='group'&&row.active!==false))
      throw new Error('Unknown or inactive Scope Group');
    return new Set(registry.filter(row=>row.parent_scope_id===group&&
      row.scope_kind==='scope'&&row.active!==false)
      .map(row=>String(row.scope_id||'').trim()).filter(Boolean));
  })().catch(error=>{groupMembershipRequests.delete(key);throw error;});
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
  // Availability flags come from the Scope itself; no management permission
  // or Galaxy/Anchor query is needed to render public features.
  const request=live();
  if(scope.id!=='local')scopeConfigInFlight.set(scope.id,request);
  return request;
}


const scopeBlocksRequests=new Map();
export function invalidateScopeBlockPage(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  scopeBlocksRequests.delete(id+':'+String(page||'index').trim().toLowerCase());
}
const BLOCK_COLUMNS='uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image';
export async function selectLiveScopeBlocks(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const name=String(page||'index').trim();
  if(!SCOPE_ID_PATTERN.test(id)||! /^[A-Za-z0-9_-]+$/.test(name))return [];
  const {rows}=await selectRows(`silver.${id}_blocks`,{
    columns:BLOCK_COLUMNS,filters:[{column:'page_name',operator:'eq',value:name}],
    limit:DB_QUERY_BATCH_SIZE,offset:0
  });
  return (rows||[]).sort((a,b)=>Number(a.block_order||0)-Number(b.block_order||0));
}
export async function pageBlocks(scopeId,type='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const name=String(type||'index').trim().toLowerCase().replace(/^home$/,'index');
  if(!SCOPE_ID_PATTERN.test(id)||! /^[a-z0-9_-]+$/.test(name))return [];
  if(id==='local')return selectLiveScopeBlocks(id,name);
  const {data,error}=await dbPublicClient.schema('silver').publicAction('page_blocks',{
    p_scope_id:id,p_type:name
  });
  if(error)throw new Error(error.message||'Page Blocks SELECT failed');
  return (Array.isArray(data)?data:[]).sort((a,b)=>Number(a.block_order||0)-Number(b.block_order||0));
}
export async function heroBlocks(scopeId,type){
  const id=String(scopeId||'').trim().toLowerCase();
  const name=String(type||'').trim().toLowerCase();
  if(!SCOPE_ID_PATTERN.test(id)||! /^[a-z][a-z0-9_-]*$/.test(name))return [];
  const {data,error}=await dbPublicClient.schema('silver').publicAction('hero_blocks',{
    p_scope_id:id,p_type:name
  });
  if(error)throw new Error(error.message||'Hero Blocks SELECT failed');
  const rows=Array.isArray(data)?data:[];
  if(!rows.length){
    // The published artwork is a bundled default when a new Scope has not
    // populated its Blocks table yet; this is not an ISR/database cache.
    const names=['group_'+name,'scope_'+name];
    const defaults=await Promise.all(names.map(page=>loadPublishedBlocks('loc',page)));
    return defaults.flatMap((items,index)=>(items||[]).map(row=>({
      ...row,page_name:names[index]
    })));
  }
  return rows.sort((a,b)=>Number(a.block_order||0)-Number(b.block_order||0));
}
export async function selectScopeBlocks(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const name=String(page||'index').trim().toLowerCase().replace(/^home$/,'index');
  if(!SCOPE_ID_PATTERN.test(id)||! /^[a-z0-9_-]+$/.test(name))return [];
  const key=id+':'+name;
  const existing=scopeBlocksRequests.get(key);
  if(existing)return existing;
  const promise=(name==='index'?pageBlocks(id,name):selectLiveScopeBlocks(id,name))
    .then(async rows=>rows.length?rows:loadPublishedBlocks(id,name))
    .catch(error=>{scopeBlocksRequests.delete(key);throw error});
  scopeBlocksRequests.set(key,promise);
  return promise;
}
