'use client';
import {isAbortError} from '../db/db-query.mjs';
import {mapBounded} from '../query/bounded-parallel.mjs';
import {searchOrderedScopeProviders} from '../search/ordered-scope-providers.mjs';
import {queryPrivateGalaxy} from '../actions/search/management-queries.mjs';


import {DEFAULT_LIST_BATCH_SIZE} from '../db/db-contract.mjs';
import {normalizeRelationIds,publicContentFilters} from '../content/content-policy';
import {timePeriodContainsDate} from '../culture/time-lucus-ranges.mjs';
import {anniversarySuggestionsForDate} from '../culture/anniversary.mjs';
import {selectRows} from '../db/db-query.mjs';
import {dbAuthClient,readLocStatistics,readScopeCategoryTotals,readScopeEarliest,readScopeOverview,readScopeStatistics} from '../db/db-client.mjs';
import {cachedRead} from '../db/semi-dynamic-cache.mjs';
import {readGalaxyFeature} from './feature-query-client.mjs';
import {readGalaxyRecords,readLucusFeature} from '../model/feature-query-client.mjs';
import {readTraceMapIndex} from '../../modular/features/trace/trace-data.js';
import {galaxyAble} from '../model/galaxy-able.mjs';
import {scopeTableDescriptor} from '../../../packages/zenstack/scope-table-names.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
const galaxyUidReadColumns=()=>galaxyReadColumns('GalaxyUidRead');
const galaxyUidReadWithPolicyColumns=()=>unique([
  ...galaxyUidReadColumns(),...galaxyReadColumns('GalaxyAttr'),
  // media_link is a physical Galaxy URL[]; select it explicitly when showing
  // article links, never treat it as a semantic ZModel Anchor relation.
  'media_link'
]);
const articlePermissionFilter=(_scope,name)=>({
  column:name,operator:'eq',value:true
});
// Search is a GalaxyAttr flag, but keeping this named predicate explicit makes
// the policy boundary visible at every search call site.
const searchPermissionFilter=()=>({column:'search',operator:'eq',value:true});

function unique(values=[]){
  return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))];
}
function scopeOf(scope){
  if(!scope?.id||!scope?.galaxy||!scope?.lucus)throw new Error('Scope data 未解析');
  return scope;
}
const dayColumn=table=>
  scopeTableDescriptor(String(table||'').split('.').at(-1))?.kind==='galaxy'?'date':'createtime';
function countBy(rows,keyOf,{includeEmpty=false}={}){
  const counts=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const key=keyOf(row);
    if(key===null||key===undefined)continue;
    if(!includeEmpty&&!key)continue;
    counts.set(key,(counts.get(key)||0)+1);
  }
  return counts;
}
function categoryCountRows(rows,column,{limit=Infinity,includeEmpty=false}={}){
  return termCountRows(countBy(rows,row=>String(row?.[column]||'').trim(),{includeEmpty}),{limit});
}
function termCountRows(counts,{limit=Infinity,includeEmpty=false}={}){
  return [...counts.entries()]
    .filter(([term])=>includeEmpty||term)
    .map(([term,item_count])=>({term,item_count}))
    .sort((a,b)=>b.item_count-a.item_count||a.term.localeCompare(b.term))
    .slice(0,limit);
}
function dailyKeyOf(row,column,{includeEmpty=false,includeUndated=false}={}){
  const category=String(row?.[column]||'').trim();
  const day=String(row?.date||row?.createtime||'').slice(0,10);
  if((!includeEmpty&&!category)||(!includeUndated&&!day))return null;
  return day+'\u0000'+category;
}
function dailyCountRows(rows,column,{includeEmpty=false,includeUndated=false}={}){
  const counts=countBy(rows,row=>dailyKeyOf(row,column,{includeEmpty,includeUndated}),{includeEmpty:true});
  return dailyRowsFromCounts(counts);
}
function dailyRowsFromCounts(counts){
  return [...counts.entries()].map(([key,item_count])=>{
    const split=key.indexOf('\u0000');
    return {day:key.slice(0,split),category:key.slice(split+1),item_count};
  }).sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
}

// Culture and Statistics share identical bounded SQL aggregates. Retain one
// successful snapshot per Scope and filter, instead of repeating COUNT/GROUP BY
// whenever a chart or route mounts. The existing public semi-dynamic cache
// invalidates on successful managed writes/imports; failures are not cached.
// No TTL, polling, extra SQL, indexed table or new cache implementation.
function cachedReadScopeStatistics(id,args){
  return cachedRead('scope-aggregate:'+id+':statistics:'+JSON.stringify(args),
    ()=>readScopeStatistics(id,args));
}
function cachedReadScopeCategoryTotals(id,args){
  return cachedRead('scope-aggregate:'+id+':categories:'+JSON.stringify(args),
    ()=>readScopeCategoryTotals(id,args));
}

// Native Kysely aggregation only. No RPC-existence probe or article-level
// fallback: SQL returns bounded daily totals, not the full Galaxy corpus.
async function scopeStatisticsRows(scope,{startDate='',endDate='',includeUndated=false}={}){
  const current=scopeOf(scope);
  const range={startDate:dateOnly(startDate),endDate:dateOnly(endDate),includeUndated};
  // Fixed requested window: use the Statistics feature query action.
  // The existing unbounded/undated summary keeps its original contract.
  if(range.startDate&&range.endDate&&!includeUndated){
    return cachedRead('scope-aggregate:'+current.id+':statistics:'+JSON.stringify(range),
      async()=>{
        const {data}=await readGalaxyFeature({
          feature:'statics',scope:current.id,startDate:range.startDate,
          endDate:range.endDate,result:'daily-sources'
        });
        return data.rows;
      });
  }
  return cachedReadScopeStatistics(current.id,range);
}
// Indexed Galaxy.date drives daily article-source statistics. Media is counted
// only as distinct article-linked UIDs in the overview, never by media date.
async function scopeDailyCounts(current,range){
  const counted=await scopeStatisticsRows(current,range);
  if(counted){
    return [
      counted.filter(row=>row.kind==='source').map(row=>({scope_id:current.id,site:row.category,day:row.day,item_count:row.item_count})),
      []
    ];
  }
  throw new Error('Culture statistics aggregate unavailable; full-row fallback is disabled');
}

// One database-side daily GROUP BY over Galaxy.site, including multimedia
// publishing platforms. There is no separate MediaAnchor counting stream.
export async function selectScopeDailyCounts(scope,{
  startDate='',endDate='',includeUndated=false,requireAggregate=false
}={}){
  const current=scopeOf(scope);
  const counted=await scopeStatisticsRows(current,{startDate,endDate,includeUndated});
  if(!counted)throw new Error('Culture requires a database-side date aggregate; full-row fallback disabled');
  const text=counted.filter(row=>row.kind==='source')
    .map(row=>({day:row.day,category:row.category,item_count:Number(row.item_count)||0}))
    .sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
  return {text};
}

// Collapsed river source totals are also grouped by the canonical Galaxy.site.
export async function selectScopeCategoryTotals(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const rows=await cachedReadScopeCategoryTotals(current.id,{
    startDate:dateOnly(startDate),endDate:dateOnly(endDate)
  });
  return {text:rows.filter(row=>row.kind==='source')
    .map(row=>({category:row.category,item_count:Number(row.item_count)||0}))
    .filter(row=>row.item_count>0)};
}

export async function selectSourceCatalog(scope,{startDate='',endDate='',limit=20}={}){
  const current=scopeOf(scope);
  const rows=await cachedReadScopeCategoryTotals(current.id,{
    startDate:dateOnly(startDate),endDate:dateOnly(endDate)
  });
  // Return the complete SQL-calculated source catalog and its true total.
  const normalized=rows.filter(row=>row.kind==='source').map(row=>({
    scope_id:current.id,site:String(row.category||''),item_count:Number(row.item_count)||0
  })).sort((a,b)=>b.item_count-a.item_count||a.site.localeCompare(b.site));
  return {rows:normalized,totalCount:normalized.length};
}

export async function selectSourceDaily(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const counted=await scopeStatisticsRows(current,{startDate,endDate});
  if(counted){
    return counted.filter(row=>row.kind==='source').map(row=>({
      scope_id:current.id,
      site:row.category,
      day:row.day,
      item_count:row.item_count
    }));
  }
  throw new Error('Source daily statistics aggregate unavailable; full-row fallback disabled');
}

// Galaxy.media_link already carries public URLs. It must not trigger any
// MediaAnchor UID lookup just to show an external link.
function mediaUrlsOf(value){
  return [...new Set((Array.isArray(value)?value:[])
    .map(item=>String(item||'').trim()).filter(url=>/^https?:\/\//i.test(url)))];
}
function resolvedLinks(row){
  const links=[];
  if(/^https?:\/\//i.test(String(row?.url||'')))
    links.push({id:'url:'+row.uid,href:row.url,label:'外部連結'});
  for(const url of mediaUrlsOf(row?.media_link))
    links.push({id:'media:'+url,href:url,label:'媒體連結'});
  return links;
}
export async function resolveGalaxyExternalLinks(_scope,rows=[]){
  return (Array.isArray(rows)?rows:[])
    .map(row=>({...row,resolved_links:resolvedLinks(row)}));
}

export async function selectGalaxyContent(scope,uid,{authenticated=false,dbId=''}={}){
  const current=scopeOf(scope);
  const id=String(uid||'').trim();
  if(!id)return null;
  // A single-article read uses the complete GalaxyUidRead projection. The
  // caller may still consume only `content`, but relation/lucus context is
  // no longer silently lost at this boundary.
  if(dbId)throw Error('Qualified external database reads need the authorized source');
  const data=await readGalaxyRecords({scope:current.id,view:'detail',uids:[id]},
    {editor:authenticated});
  return data.rows[0]||null;
}

async function relatedArticleTitlesFor(scope,row,{includeHidden=false,dbId=''}={}){
  const ids=[...new Set([row.source_id,row.ref_id,...(normalizeRelationIds(row.target_id)||[])]
    .map(value=>String(value||'').trim()).filter(Boolean))];
  if(!ids.length)return {};
  const batches=[];
  for(let i=0;i<ids.length;i+=50)batches.push(ids.slice(i,i+50));
  const pages=await mapBounded(batches,async batch=>{
    if(dbId)throw Error('Qualified external database reads need the authorized source');
    const {rows}=await readGalaxyRecords({scope:scope.id,view:'list',uids:batch},
      {editor:includeHidden});
    return rows;
  });
  return Object.fromEntries(pages.flat().map(item=>[String(item.uid),String(item.title||'').trim()]));
}


function articleDate(value){
  const day=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:'';
}
function shiftedDay(day,shift){
  const d=new Date(day+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+shift);
  return d.toISOString().slice(0,10);
}
// A selected article only needs the lightweight Time graph. Share the
// canonical Culture range resolution among article reads for a short TTL.
const articleTimeCache=new Map();
// Date, period, era and anniversary data share a single Time graph request.
async function articleTimeRows(scope){
  const key=String(scope.id)+'|'+String(scope.time),now=Date.now();
  const cached=articleTimeCache.get(key);
  if(cached&&cached.expires>now)return cached.promise;
  const promise=import('../culture/query')
    .then(({selectCultureTimeRows})=>selectCultureTimeRows(scope));
  articleTimeCache.set(key,{expires:now+60_000,promise});
  promise.catch(()=>{if(articleTimeCache.get(key)?.promise===promise)articleTimeCache.delete(key);});
  if(articleTimeCache.size>20)articleTimeCache.delete(articleTimeCache.keys().next().value);
  return promise;
}
async function articleTimeContext(scope,day){
  if(!day||!scope.time)return {anchors:[],periods:[],eras:[]};
  const rows=await articleTimeRows(scope);
  const matches=row=>timePeriodContainsDate(row,day);
  const labels=items=>items.map(item=>({uid:String(item.uid),title:String(item.title||'')}));
  const dateAnchors=rows.filter(row=>row.entry_type==='lucus');
  const anchors=dateAnchors.filter(row=>String(row.address||'').slice(0,10)===day);
  let anniversarySuggestions=[];
  if(!anchors.length){
    try{anniversarySuggestions=anniversarySuggestionsForDate(day,dateAnchors,{birthday:scope.birthday});}
    catch{/* Anniversary hints must not hide the article Time context. */}
  }
  return {
    anchors:labels(anchors),
    periods:labels(rows.filter(row=>row.entry_type==='period'&&matches(row))),
    eras:labels(rows.filter(row=>row.entry_type==='era'&&matches(row))),
    anniversarySuggestions
  };
}
async function articleSpaceContext(scope,placeId,{authenticated=false}={}){
  if(!/^[A-Za-z0-9]{8}$/.test(placeId)||!scope?.id||scope.id==='loc')
    return {place:null,routes:[],traces:[]};
    // LOC's four legacy relations were consolidated into _lucus. The shared
    // Trace reader projects native attr.point/attr.path without relying on
    // removed trace_type, anchor_list or route_list physical columns.
    const [pointPage,maps]=await Promise.all([
      readLucusFeature({scope:scope.id,family:'space',
        types:['point'],uids:[placeId],limit:1},{editor:authenticated})
        .then(data=>({rows:data.rows})),
      readTraceMapIndex(scope.id,{includeHidden:authenticated})
    ]);
    const place=pointPage.rows[0]||null;
    if(!place)return {place:null,routes:[],traces:[]};
    const contains=(uids,uid)=>Array.isArray(uids)&&uids.includes(uid);
    const routes=maps.filter(row=>row.trace_type==='path'&&contains(row.anchor_list,placeId))
      .map(({uid,title})=>({uid,title})).slice(0,100);
    const routeUids=new Set(routes.map(row=>row.uid));
    const traces=maps.filter(row=>row.trace_type==='trace'&&(
      contains(row.anchor_list,placeId)||
      (row.route_list?.routes||[]).some(uid=>routeUids.has(uid))
    )).map(({uid,title})=>({uid,title})).slice(0,100);
    return {place:{uid:place.uid,title:place.title},routes,traces};
}
function articleStatisticsContext(scope,day){
  if(!day)return null;
  const weekday=(new Date(day+'T00:00:00Z').getUTCDay()+6)%7;
  const weekStart=shiftedDay(day,-weekday),weekEnd=shiftedDay(weekStart,6);
  const yearStart=day.slice(0,4)+'-01-01',yearEnd=day.slice(0,4)+'-12-31';
  // Statistics receives only the derived date window and runs its own
  // existing grouped reader when the user follows the link.
  return {week:{start:weekStart,end:weekEnd},
    year:{start:yearStart,end:yearEnd}};
}

export async function selectGalaxyIdentity(scope,uid,{includeHidden=false,dbId='',federated=false}={}){
  const current=scopeOf(scope);
  const id=String(uid||'').trim();
  if(!id)return null;
  // One exact UID SELECT loads the selected article through GalaxyUidRead;
  // list paths stay on GalaxyList and never read article content.
  if(dbId)throw Error('Qualified external database reads need the authorized source');
  const {rows:articleRows}=await readGalaxyRecords({
    scope:current.id,view:'detail',uids:[id]
  },{editor:includeHidden});
  const row=articleRows[0]||null;
  if(!row||(!includeHidden&&galaxyAble(row).list===false))return null;
  const placeId=String(row.place_id||'').trim();
  const day=articleDate(row.date);
  const [relationTitles,space,time,statistics]=await Promise.all([
    relatedArticleTitlesFor(current,row,{includeHidden,dbId:federated?dbId:''}).catch(()=>({})),
    federated?Promise.resolve({place:null,routes:[],traces:[]}):
      articleSpaceContext(current,placeId,{authenticated:includeHidden}).catch(()=>({place:null,routes:[],traces:[]})),
    federated?Promise.resolve({anchors:[],periods:[],eras:[]}):
      articleTimeContext(current,day).catch(()=>({anchors:[],periods:[],eras:[]})),
    articleStatisticsContext(current,day)
  ]);
  // Existing 2026 records sometimes stored card spreads on non-rune media.
  // Expose them as a read-only rune media view until the verified data backfill;
  // do not modify or duplicate any Galaxy article in a read request.
  // Keep media and original article URLs as distinct associations.
  return {...row,scope_id:current.id,__db_id:dbId||row.__db_id||'',__table:current.galaxy,
    inter_net_federated:Boolean(federated),
    links:resolvedLinks(row),relation_titles:relationTitles,
    related_media:[],trace_place:space.place,
    related_space:space,related_time:time,related_statistics:statistics,
    article_day:day};
}

function recordFor(row,source,providerId,scope,table){
  return {row:{...row,scope_id:row?.scope_id||scope.id,__table:table,__media_lucus_table:scope.lucus},source,providerId};
}

// Search selections use the same enabled categories and alias assignments as
// Statistics. Unmapped or disabled-category aliases belong to Others.
function resolveSourceSelection(value,taxonomy={}){
  const selected=String(value||'').trim();
  if(!selected)return {kind:'all',names:[]};
  if(!selected.startsWith('category:')){
    const raw=selected.startsWith('source:')?selected.slice(7):selected;
    return {kind:raw?'names':'none',names:raw?[raw]:[]};
  }
  const code=selected.slice(9).toLowerCase();
  const categories=taxonomy?.categories||[];
  const active=new Set(categories.filter(row=>row.enabled!==false)
    .map(row=>String(row.category_code||'').toLowerCase()));
  // Statistics always has the implicit Others category when not configured.
  active.add('others');
  if(!active.has(code))return {kind:'none',names:[]};
  const aliases=taxonomy?.aliases||[];
  const rows=aliases.filter(row=>String(row.source_key||'').trim());
  if(code==='others')return {kind:'others',names:[...new Set(rows
    .filter(row=>active.has(String(row.category_code||'').toLowerCase())&&
      String(row.category_code||'').toLowerCase()!=='others')
    .map(row=>String(row.source_key).trim()))]};
  const names=[...new Set(rows.filter(row=>String(row.category_code||'').toLowerCase()===code)
    .map(row=>String(row.source_key).trim()))];
  return {kind:names.length?'names':'none',names};
}

// Public Search uses the fixed GalaxySearch model, never a browser-supplied
// table, projection, OR-AST or SQL predicate. All results are GalaxyList rows.
function genericScopeProviders(scope){
  // Guest Search is intentionally title/content-only, with optional dates.
  // Site classification belongs to the shared loc_lucus source statistics;
  // location belongs to Trace and authorized management, not guest Search.
  const current=scopeOf(scope);
  const source=current.id+' 文章',id=current.id+':article-content';
  return [Object.freeze({
    id,
    async search(value,{cursor=0,startDate='',endDate='',and=[],nor=[],
      limit=DEFAULT_LIST_BATCH_SIZE,browse=false,signal=null,sortDirection='asc'}={}){
      const offset=Math.max(0,Math.floor(Number(cursor)||0));
      const {data}=await readGalaxyFeature({
        feature:'search',scope:current.id,
        startDate:startDate||undefined,endDate:endDate||undefined,
        text:browse?undefined:String(value||'').trim()||undefined,
        requiredTerms:and.length?and:undefined,
        excludedTerms:nor.length?nor:undefined,
        result:'articles',offset,
        limit:Math.max(1,Math.min(100,Math.floor(Number(limit)||DEFAULT_LIST_BATCH_SIZE))),
        sortDirection:sortDirection==='desc'?'desc':'asc',signal
      });
      const rows=(data.rows||[]).map(row=>recordFor(row,source,id,current,current.galaxy));
      return {rows,hasMore:data.hasMore===true,
        nextCursor:data.nextCursor?.offset??null,totalCount:null,dataSource:'primary'};
    }
  })];
}

function normalizeSearch(value){
  return String(value??'').normalize('NFKC').toLocaleLowerCase('zh-Hant').replace(/[\s\u3000]+/g,'');
}
// Scope tables are independent, so one LOC-wide keyword used to fire one request per
// Scope at once. A small worker pool keeps the browser's connection slots free for
// the primary search request, and the signal stops the remaining work on re-search.
// Deprecated Time style labels are not a search provider. Their classification
// is handled by the Advanced Search keyword path; keep a no-op for old imports.
export async function selectStyleKeywordMatches(){return [];}

// Search-only private results use this fixed Search Server Action, which checks
// the published JavaScript Scope grant before opening its direct DB connection.
// Site/Keyword/Media readers and their public visibility rules stay unchanged.
export async function searchAuthorizedGalaxyRows(scopes,query,{
  limit=DEFAULT_LIST_BATCH_SIZE,cursor=null,startDate='',endDate='',
  contentType='',sourceFilter='',sourceTaxonomy=null,placeOnly=false,
  signal=null,sortDirection='asc'
}={}){
  const q=String(query||'').trim();
  if(!q)return {rows:[],failures:[],hasMore:false,nextCursor:null};
  const scopeList=(Array.isArray(scopes)?scopes:[]).filter(scope=>scope?.id&&scope?.galaxy);
  const selection=resolveSourceSelection(sourceFilter,sourceTaxonomy||{});
  if(selection.kind==='none')return {rows:[],failures:[],hasMore:false,nextCursor:null};
  if((selection.names||[]).length>100)throw Error('所選來源超過搜尋上限，請縮小來源範圍');
  const providers=scopeList.map(scope=>({
    id:scope.id+':private-galaxy',
    async search(value,{cursor:offset=0,startDate:start='',endDate:end='',
      limit:batch=DEFAULT_LIST_BATCH_SIZE,sortDirection:direction='asc',signal:requestSignal=null}={}){
      if(requestSignal?.aborted){
        const cancelled=new Error('Search cancelled');cancelled.name='AbortError';throw cancelled;
      }
      const {data}=await queryPrivateGalaxy({
        p_scope_id:scope.id,p_query:value,p_offset:offset,
        p_limit:Math.max(1,Math.min(100,Math.floor(Number(batch)||DEFAULT_LIST_BATCH_SIZE))),
        p_start_date:start||null,p_end_date:end||null,
        p_sort_direction:direction==='desc'?'desc':'asc',
        p_content_type:['','galaxy','lyrics_work','text_work'].includes(contentType)?contentType:'',
        p_source_mode:selection.kind,
        p_sources:selection.names||[],
        p_place_only:Boolean(placeOnly)
      });
      if(requestSignal?.aborted){
        const cancelled=new Error('Search cancelled');cancelled.name='AbortError';throw cancelled;
      }
      if(!data||!Array.isArray(data.rows))throw Error('Invalid private Search response');
      return {
        rows:data.rows.map(row=>recordFor(row,scope.id+' 文章',
          scope.id+':private-galaxy',scope,scope.galaxy)),
        hasMore:data.hasMore===true,nextCursor:data.nextCursor??null,dataSource:'verified'
      };
    }
  }));
  return searchOrderedScopeProviders(providers,q,{
    cursor,startDate,endDate,limit,signal,sortDirection
  });
}

export async function searchGalaxyRows(scopes,query,{
  limit=DEFAULT_LIST_BATCH_SIZE,cursor=null,startDate='',endDate='',and=[],nor=[],hiddenScopeIds=[],contentType='',sourceFilter='',sourceTaxonomy=null,placeOnly=false,browse=false,signal=null,sortDirection='asc',managementOnly=false
}={}){
  const q=String(query||'').trim();
  if(!q&&!browse)return {rows:[],failures:[],hasMore:false,nextCursor:null};
  const safeLimit=Math.max(1,Math.min(DEFAULT_LIST_BATCH_SIZE,Math.floor(Number(limit)||DEFAULT_LIST_BATCH_SIZE)));
  const scopeList=(Array.isArray(scopes)?scopes:[]).filter(scope=>scope?.id);
  const hiddenScopes=new Set((Array.isArray(hiddenScopeIds)?hiddenScopeIds:[]).map(value=>String(value||'').trim()).filter(Boolean));
  // A manager's hidden Scope uses LOC Native's authenticated search action.
  // Public Search never inherits a browser-declared "include hidden" switch.
  if(managementOnly)return searchAuthorizedGalaxyRows(scopeList,q,{
    limit:safeLimit,cursor,startDate,endDate,contentType,sourceFilter,
    sourceTaxonomy,placeOnly,signal,sortDirection
  });
  const scopeProviders=scopeList.map(scope=>hiddenScopes.has(scope.id)
    ?[Object.freeze({
      id:scope.id+':private-galaxy',
      async search(value,options={}){
        const result=await searchAuthorizedGalaxyRows([scope],value,{
          limit:options.limit,startDate:options.startDate,endDate:options.endDate,
          cursor:options.cursor?{stage:1,offset:options.cursor}:null,
          contentType,sourceFilter,sourceTaxonomy,placeOnly,
          signal:options.signal,sortDirection:options.sortDirection
        });
        return {...result,nextCursor:result.nextCursor?.offset??null,
          dataSource:'verified'};
      }
    })]
    :genericScopeProviders(scope));
  // Search is article-led: one Galaxy.content provider per Scope, with
  // Anchor relationships available only after choosing an article.
  const providers=scopeProviders.flat();
  // Preserve the same provider ordering and stage cursor while overlapping
  // only the expensive no-match path. One first-Scope hit still costs ONE query.
  return searchOrderedScopeProviders(providers,q,{
    cursor,startDate,endDate,and,nor,limit:safeLimit,
    browse,signal,sortDirection
  });
}


export async function hydrateGalaxySearchRows(entries=[],scopes=[],hiddenScopeIds=[],{signal=null}={}){
  const items=Array.isArray(entries)?entries:[];
  const scopeMap=new Map((Array.isArray(scopes)?scopes:[]).map(scope=>[scope.id,scope]));
  const privateScopes=new Set(hiddenScopeIds||[]);
  const batches=new Map();
  const identity=(scopeId,dbId,uid)=>JSON.stringify([scopeId,dbId,uid]);
  for(const entry of items){
    const row=entry?.row;
    // The fixed GalaxySearch article model already returned its complete
    // lightweight metadata. Never issue a second SELECT for the same record.
    if(row&&Object.hasOwn(row,'site')&&Object.hasOwn(row,'title')&&
      Object.hasOwn(row,'list'))continue;
    const uid=String(row?.uid||'').trim();
    const scope=scopeMap.get(row?.scope_id);
    if(!uid||!scope?.galaxy)continue;
    const dbId=String(row.__db_id||'');
    const key=JSON.stringify([scope.id,dbId]);
    if(!batches.has(key))batches.set(key,{scope,dbId,ids:new Set()});
    batches.get(key).ids.add(uid);
  }
  const metadata=new Map();
  await mapBounded([...batches.values()],async({scope,dbId,ids})=>{
    const keys=[...ids];
    if(keys.length>DEFAULT_LIST_BATCH_SIZE)throw new Error('Search page exceeds bounded UID limit');
    if(dbId)throw Error('External qualified record reads need an authorized database source');
    const {rows}=await readGalaxyRecords({scope:scope.id,view:'list',uids:keys},
      {editor:privateScopes.has(scope.id),signal});
    for(const row of rows||[])metadata.set(identity(scope.id,dbId,row.uid),row);
  });
  return items.map(entry=>{
    const row=entry?.row;
    if(!row?.uid)return entry;
    const dbId=String(row.__db_id||'');
    const details=metadata.get(identity(row.scope_id,dbId,row.uid));
    return details?{...entry,row:{...row,...details}}:entry;
  });
}
const SOURCE_BUCKET_ORDER=['Facebook','Threads','IG','Others'];
function dateOnly(value){return String(value||'').slice(0,10);}
function sourceBucket(value=''){
  const source=String(value||'').trim().toLowerCase();
  if(source.includes('facebook')||source==='fb')return 'Facebook';
  if(source.includes('threads'))return 'Threads';
  if(source.includes('instagram')||source.includes('reels')||source==='ig')return 'IG';
  return 'Others';
}
async function scopeSourceTrendRows(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const [textDaily]=await scopeDailyCounts(current,{startDate,endDate});
  const combined=new Map();
  for(const row of textDaily){
    const day=dateOnly(row.day); if(!day)continue;
    const bucket=sourceBucket(row.site),key=day+'|'+bucket;
    combined.set(key,(combined.get(key)||0)+(Number(row.item_count)||0));
  }

  return [...combined.entries()].map(([key,item_count])=>{
    const split=key.indexOf('|');
    return {day:key.slice(0,split),source:key.slice(split+1),item_count:Number(item_count)||0};
  }).sort((a,b)=>a.day.localeCompare(b.day)||SOURCE_BUCKET_ORDER.indexOf(a.source)-SOURCE_BUCKET_ORDER.indexOf(b.source));
}

async function scopeDensityRows(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const [textDaily]=await scopeDailyCounts(current,{startDate,endDate});
  const daily=new Map();
  for(const row of textDaily){
    const day=dateOnly(row.day);
    if(!day)continue;
    daily.set(day,(daily.get(day)||0)+(Number(row.item_count)||0));
  }
  return [...daily.entries()]
    .map(([day,item_count])=>({scope_id:current.id,day,item_count}))
    .sort((a,b)=>a.day.localeCompare(b.day));
}

async function selectScopeDensityRowsRaw(scopes,{startDate='',endDate=''}={}){
  const range={startDate:dateOnly(startDate),endDate:dateOnly(endDate)};
  return (await mapBounded(Array.isArray(scopes)?scopes:[],scope=>scopeDensityRows(scope,range)))
    .flat()
    .sort((a,b)=>a.day.localeCompare(b.day)||a.scope_id.localeCompare(b.scope_id));
}

// Single-row ordered probes: determine the first *actual* statistic item
// without loading the full corpus or inventing a historical year ceiling.
export async function selectFirstScopeStatisticsDate(scope){
  const current=scopeOf(scope);
  if(current.id!=='local'){
    const {data}=await readGalaxyFeature({
      feature:'statics',scope:current.id,result:'earliest'
    });
    const day=String(data.earliest||'').slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:'';
  }
  const text=await selectRows(current.galaxy,{
    columns:dayColumn(current.galaxy),
    filters:publicContentFilters([articlePermissionFilter(current,'culture')]),
    orders:[{column:dayColumn(current.galaxy),ascending:true,nullsFirst:false}],
    limit:1
  });
  return String(text.rows?.[0]?.[dayColumn(current.galaxy)]||'').slice(0,10);
}

// One request per chart. The database returns the earliest date, the exact daily
// counts and the small source taxonomy together; the row-level readers below only
// serve while the functions are not installed (for example on a backup database).
async function selectScopeOverviewRaw(scope,{startDate='',endDate='',signal=null}={}){
  const current=scopeOf(scope);
  return readScopeOverview(current.id,{startDate,endDate,signal});
}
async function selectScopeEarliestRaw(scope){
  const current=scopeOf(scope);
  return readScopeEarliest(current.id);
}
async function selectLocStatisticsRaw({startDate='',endDate=''}={}){
  return readLocStatistics({startDate,endDate});
}

// Galaxy.site is the single source breakdown, including multimedia publishers.
export async function selectScopeSourceBreakdownRows(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const counted=await scopeStatisticsRows(current,{startDate,endDate});
  if(counted)return counted;
  // Statistics must never fetch all Galaxy article rows into the browser
  // to recreate a daily aggregate. An unavailable DB aggregate is an error.
  throw new Error('Scope statistics aggregate unavailable; full-row fallback disabled');
}

export async function selectSourceTrendRows(scopes,{startDate='',endDate=''}={}){
  const range={startDate:dateOnly(startDate),endDate:dateOnly(endDate)};
  const rows=(await mapBounded(Array.isArray(scopes)?scopes:[],scope=>scopeSourceTrendRows(scope,range))).flat();
  const merged=new Map();
  for(const row of rows){
    const key=row.day+'|'+row.source;
    merged.set(key,(merged.get(key)||0)+(Number(row.item_count)||0));
  }
  return [...merged.entries()].map(([key,item_count])=>{
    const split=key.indexOf('|');
    return {day:key.slice(0,split),source:key.slice(split+1),item_count:Number(item_count)||0};
  }).sort((a,b)=>a.day.localeCompare(b.day)||SOURCE_BUCKET_ORDER.indexOf(a.source)-SOURCE_BUCKET_ORDER.indexOf(b.source));
}

// Optional ancillary statistics may still show an empty state after failure.
// The primary Statistics overview deliberately does NOT use this wrapper:
// an unavailable Galaxy aggregate is an error, not a verified zero count.
// Cancellation (AbortError) is rethrown.
function emptyOnFailure(fn,fallback){
  return async(...args)=>{
    try{return await fn(...args);}
    catch(error){
      if(isAbortError(error))throw error;
      console.warn('[statistics] read failed; showing empty result',error?.message||error);
      return structuredClone(fallback);
    }
  };
}
export const selectScopeDensityRows=emptyOnFailure(selectScopeDensityRowsRaw,[]);
// A failed Statistics overview is a query failure, never a legitimate zero chart.
// Let useAsyncResource display the actual request error and its retry action.
export const selectScopeOverview=selectScopeOverviewRaw;
export const selectScopeEarliest=emptyOnFailure(selectScopeEarliestRaw,'');
export const selectLocStatistics=emptyOnFailure(selectLocStatisticsRaw,{earliest:'',scopes:[],rows:[]});
