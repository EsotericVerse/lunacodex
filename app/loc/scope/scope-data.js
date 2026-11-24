'use client';


import {queryBlockContent,queryBlocks} from '../actions/blocks/queries.mjs';
import {queryCultureContent} from '../actions/culture/queries.mjs';
import {queryStaticsContent} from '../actions/statics/queries.mjs';
import {selectRows} from '../db/db-query.mjs';
import {scopeConfigColumns,scopeFeatureEnabled} from './scope-config-fields.mjs';
import {Capacitor} from '@capacitor/core';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {PUBLISHED_SITE_BOOTSTRAP} from '../../modular/published-site-bootstrap.js';
import {hasPublishedBlocks,loadPublishedBlocks} from '../../modular/published-blocks/index.js';
import {cachedRead,invalidateCachedRead,invalidateCachedReadPrefix} from '../db/semi-dynamic-cache.mjs';
import {getOrLoadScopedRead,invalidateScopedReadCache} from '../../../packages/zenstack/scoped-read-cache.mjs';

// Public page copy (Title_TW/Desc_TW) now travels inside the shared
// app-bootstrap request (see app/loc/runtime/app-bootstrap.js); there is no
// standalone per-page RPC call for it any more.
// Scope identity, membership, routing and grants come from the published
// JavaScript snapshot. silver.loc supplies public display metadata.
// Public queries never fetch the private api.manage relation.

const SCOPE_ID_PATTERN=/^[a-z][a-z0-9]{0,14}$/;
const TABLE_TOKEN_PATTERN=/^[a-z][a-z0-9_]*$/;

// No remote ISR address is permitted, including when an old build
// environment variable still contains one.
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
    // TimeAnchor (Galaxy.date/createtime), LocationAnchor (location/place_id),
// MediaAnchor (media_link), KeywordAnchor (keyword), SiteAnchor (site) all reuse Anchor.
// One physical store for Time, Trace, Keywords and Media.
    anchor:`silver.${id}_${anchorSuffix}`,
    // Time and Keyword share the same typed physical Anchor.
    time:`silver.${id}_${anchorSuffix}`,
    keywords:`silver.${id}_${anchorSuffix}`,
    blocks:id==='loc'?'silver.loc_anchor':`silver.${id}_blocks`
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
  // Scope membership and physical suffixes are already published in the
  // release registry. The browser's public Data API exposes silver, NOT api.
  // Never query the private api.manage schema for a public Scope chooser.
  const rows=(PUBLISHED_SITE_BOOTSTRAP.registry||[])
    .filter(row=>row?.active!==false&&row?.scope_kind==='scope')
    .map(row=>({
      id:row.scope_id,manage_role:'scope',galaxy_table:'galaxy',
      anchor_table:'anchor',
      birthday:PUBLISHED_SITE_BOOTSTRAP.scope_birthdays?.[row.scope_id]||''
    }));
  managedScopesRequest=Promise.resolve(scopeDataFromManageRows(rows));
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

// silver.scope_registry is retired; public routing/config is release-published.
// A public Blocks page uses its published snapshot when one exists.
// One public site snapshot per client runtime (including concurrent mounts).
// Registry, theme catalogue and page-copy are shared by all Scope pages.
let publicSiteBootstrapRequest=null;
// Only explicit admin metadata refreshes invalidate the public client snapshot.
// Guest navigation shares the same promise and never preflights authorization.
export function invalidatePublicScopeMetadata(){
  managedScopesRequest=null;
  publicSiteBootstrapRequest=null;
  invalidateCachedReadPrefix('scope-config:');
  invalidateScopedReadCache();
  if(typeof window!=='undefined'){
    window.dispatchEvent(new Event('loc-public-scope-metadata-changed'));
  }
}
// Client-query invalidation and direct database reads provide freshness;
// no API request or background ISR cache invalidation is necessary.
export async function revalidateServerMetadata(){return false;}
export function selectPublicSiteBootstrap(){
  if(publicSiteBootstrapRequest)return publicSiteBootstrapRequest;
  // Registry, visitor Scope config and ordinary presentation are static.
  // Explicit editing reads are separately authorized and stay live.
  // Never call a retired
  // public-action endpoint here: the temporary public Data API cannot run it.
  publicSiteBootstrapRequest=Promise.resolve({...PUBLISHED_SITE_BOOTSTRAP,
    config:SCOPE_ROUTE_INDEX.find(row=>row.scope_id==='loc')?.config||null
  });
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
  // LOC Group membership is owned by api.manage, not by front-end routes.
  const members=await selectScopeGroupMemberIds('loc','search');
  const registry=await selectScopeRegistry({scopeKind:'scope'});
  // This is a public chooser, not an authoring read: flags and labels were
  // already published with the site. Never fan out one SQL read per Scope.
  return registry
    .filter(row=>row.active&&members.has(row.scope_id))
    .map(row=>{
      const config=publishedConfig(row.scope_id);
      if(!config||!scopeFeatureEnabled(config,'search'))return null;
      const scope=defaultScopeData(row.scope_id);
      return scope?{...scope,display_name:String(config.display_name||row.display_name||row.scope_id).trim()}:null;
    }).filter(Boolean);
}

// Group reads use explicitly published membership on ordinary pages; keep the
// caller's exact Culture/Trace range, pagination and visibility queries intact.
// Pure in-memory lookup against the already-loaded published bootstrap —
// no network call, so there is nothing here that needs a cache at all.
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
  // Group presentation uses the same published snapshot as the public route.
  // Private Scope edits still use selectScopeConfig() on explicit entry.
  return rows.map(row=>{
    if(row.scope_kind!=='scope')return row;
    const config=publishedConfig(row.scope_id);
    return {
      ...row,
      display_name:String(config?.display_name||row.display_name||row.scope_id).trim(),
      search_intro:String(config?.search_intro||'').trim(),
      search_aliases:Array.isArray(config?.search_aliases)?config.search_aliases:[]
    };
  });
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
// Public metadata is read lazily when its feature opens.
// Authorized metadata writes explicitly clear these per-session snapshots.
// The browser sends a fixed business request to the existing LOC application.
// No SQL, relation, filter, dialect, credentials or connection URL are accepted.
async function nativePublicContent(kind,scope,feature=''){
  const params=new URLSearchParams({kind,scope});
  if(feature)params.set('feature',feature);
  const payload=kind==='config'||kind==='block_list'||kind==='hero_block'
    ?await queryBlockContent(params)
    :kind==='culture_anchors'||kind==='culture_density'
      ?await queryCultureContent(params.toString())
      :await queryStaticsContent(params.toString());
  return payload.data;
}
const publishedConfig=id=>SCOPE_ROUTE_INDEX.find(row=>row.scope_id===id&&row.active!==false)?.config||null;
export function selectScopeConfig(scopeId){
  const scope=defaultScopeData(scopeId);
  if(!scope)return Promise.resolve(null);
  if(scope.id==='local')return Promise.resolve(null);
  // Published configuration is the guest fallback. Live feature configuration
  // is read through the existing application runtime's native Kysely driver.
  // Never let an unavailable SQL connection blank a public Scope page.
  // Only cache successful live SQL reads. Offline published fallbacks still
  // render immediately, but must not prevent a later live retry.
  return cachedRead('scope-config:'+scope.id,
    ()=>nativePublicContent('config',scope.id))
    .then(data=>data||publishedConfig(scope.id))
    .catch(()=>publishedConfig(scope.id));
}


// Presentation Blocks and public Anchor projections share the same physical
// ZModel-backed read cache. LOC's Blocks are typed rows in silver.loc_anchor.
// This is NOT a SQL idx/index, IndexedDB or a second Cache Storage layer.
const blockRelation=id=>'silver.'+(id==='loc'?'loc_anchor':id+'_blocks');
export function invalidateScopeBlockPage(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  if(id==='local'||!SCOPE_ID_PATTERN.test(id))return;
  // All projections for one written physical relation become stale together.
  // Page is retained in the API for its existing editor callers.
  invalidateScopedReadCache(blockRelation(id));
}
// Public display readers of the same Scope share one parsed Block-list result.
export function block_list(scopeid){
  const id=String(scopeid||'').trim().toLowerCase();
  if(id==='local'||!SCOPE_ID_PATTERN.test(id))return Promise.resolve([]);
  return getOrLoadScopedRead(blockRelation(id),['native','block_list'],async()=>{
    const rows=await nativePublicContent('block_list',id);
    return Array.isArray(rows)?rows:[];
  });
}
// Preserve PR #1762: a direct Hero read is ALWAYS fresh. The editor reads
// this before writing, so it must never consume a display-time cache entry
// that could overwrite a concurrent edit from another browser.
export async function hero_block(specificValue){
  const types=Array.isArray(specificValue)?specificValue:[specificValue];
  if(!types.length||types.length>2||new Set(types).size!==types.length||
    types.some(type=>typeof type!=='string'||
      !/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(type)||
      ['from','domain','galaxy','universe','index','governance'].includes(type)))
    return [];
  const rows=await nativePublicContent('hero_block','loc',types.join(','));
  return Array.isArray(rows)?rows:[];
}
// Edits/verification need an authoritative fresh read, not the public display
// cache. Rendering uses selectScopeBlocks() below.
export async function selectLiveScopeBlocks(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const name=String(page||'index').trim();
  if(id==='local'||!SCOPE_ID_PATTERN.test(id)||!/^[A-Za-z0-9_-]+$/.test(name))return [];
  if(id==='loc'){
    const rows=['index','governance'].includes(name)
      ?(await nativePublicContent('block_list',id)).filter(row=>row.page_name===name)
      :await hero_block(name);
    return [...rows].sort((a,b)=>(Number(a.block_order)||0)-(Number(b.block_order)||0));
  }
  if(name==='index'){
    const rows=await nativePublicContent('block_list',id);
    return Array.isArray(rows)?rows:[];
  }
  // The blocks action reads only approved public presentation data.
  // Scope Block pages are presentation content: use the existing, fixed,
  // page-exact block_list action. It reads only approved public Block pages,
  // never requests Manage/Auth data and never performs a write.
  const payload=await queryBlocks('block_list',{p_scope_id:id,p_page_name:name});
  return payload.data.filter(row=>String(row.page_name||'')===name)
    .sort((a,b)=>(Number(a.block_order)||0)-(Number(b.block_order)||0));
}
export async function selectScopeBlocks(scopeId,page='index'){
  const id=String(scopeId||'').trim().toLowerCase();
  const name=String(page||'index').trim().toLowerCase().replace(/^home$/,'index');
  if(id==='local'||!SCOPE_ID_PATTERN.test(id)||!/^[a-z0-9_-]+$/.test(name))return [];
  // Even an intentionally EMPTY published page is complete presentation
  // data. Don't probe SQL for freshness on ordinary navigation. The editor
  // uses selectLiveScopeBlocks() and never consumes this release snapshot.
  if(hasPublishedBlocks(id,name))return loadPublishedBlocks(id,name);
  // An as-yet-unpublished page retains its existing on-demand SQL fallback.
  return getOrLoadScopedRead(blockRelation(id),['page','blocks',name],
    ()=>selectLiveScopeBlocks(id,name));
}
