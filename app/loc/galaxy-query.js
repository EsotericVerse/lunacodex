'use client';
import {isAbortError} from './db-query.mjs';
import {mapBounded} from './bounded-parallel.mjs';
import {searchOrderedScopeProviders} from './search-ordered-scope-providers.mjs';


import {StatisticsFacets} from './statistics-facets';
import {DEFAULT_LIST_BATCH_SIZE} from './db-contract.mjs';
import {parseSearchQuery} from './search-query.mjs';
import {normalizeRelationIds,publicContentFilters} from './content-policy';
import {timePeriodContainsDate} from './time-anchor-ranges.mjs';
import {anniversarySuggestionsForDate} from './anniversary.mjs';
import {DB_QUERY_BATCH_SIZE,applyFilters,applyOrders,executePublicRead,selectCount,selectRows} from './db-query.mjs';
import {readLocStatistics,readScopeCategoryTotals,readScopeEarliest,readScopeOverview,readScopeStatistics} from './db-client.mjs';
import {readNumericIsr,usesNumericIsr} from './numeric-isr-client';
import {readTraceMapIndex} from '../modular/features/trace/trace-data.js';
import {galaxyAble} from './galaxy-able.mjs';
import {portableContainsTerm} from './providers/portable-search.mjs';
import {galaxyReadColumns} from '../../zenstack/galaxy-read-models.mjs';
const galaxyListColumns=()=>galaxyReadColumns('GalaxyList');
const galaxyUidReadColumns=()=>galaxyReadColumns('GalaxyUidRead');
const galaxyUidReadWithPolicyColumns=()=>unique([
  ...galaxyUidReadColumns(),...galaxyReadColumns('GalaxyAttr')
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
  if(!scope?.id||!scope?.galaxy||!scope?.galaxyMedia||!scope?.time)throw new Error('Scope data 未解析');
  return scope;
}
function timeFilters(column,startDate,endDate){
  const filters=[],isDate=column==='date';
  if(startDate)filters.push({column,operator:'gte',value:String(startDate).slice(0,10)+(isDate?'':'T00:00:00+08:00')});
  if(endDate)filters.push({column,operator:'lte',value:String(endDate).slice(0,10)+(isDate?'':'T23:59:59.999+08:00')});
  return filters;
}
const dayColumn=table=>
  /^silver\.[a-z][a-z0-9]*_galaxy$/.test(String(table||''))?'date':'createtime';
async function selectRowById(table,{idColumn,id,columns,authenticated=false,expectedDbId=''}={}){
  const page=await selectRows(table,{columns,filters:[{column:idColumn,operator:'eq',value:String(id)}],limit:1,authenticated,expectedDbId});
  return page.rows[0]||null;
}
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

// A Statistics/Culture page view commonly renders more than one chart for the
// same Scope + date range in one render pass. Coalesce the concurrent identical
// Kysely aggregate requests into one instead of duplicating SQL — but keep NO
// cache: the entry is released the moment the request settles, so a later read
// always hits the database fresh. LOC holds no client-side data cache.
function dedupeInflight(pending,key,factory){
  const existing=pending.get(key);
  if(existing)return existing;
  const promise=factory();
  pending.set(key,promise);
  const release=()=>{if(pending.get(key)===promise)pending.delete(key);};
  promise.then(release,release);
  return promise;
}
const scopeStatisticsInflight=new Map();
const scopeCategoryTotalsInflight=new Map();
function cachedReadScopeStatistics(id,args){
  const key=String(id)+'|'+JSON.stringify(args);
  return dedupeInflight(scopeStatisticsInflight,key,()=>readScopeStatistics(id,args));
}
function cachedReadScopeCategoryTotals(id,args){
  const key=String(id)+'|'+JSON.stringify(args);
  return dedupeInflight(scopeCategoryTotalsInflight,key,()=>readScopeCategoryTotals(id,args));
}

// Native Kysely aggregation only. No RPC-existence probe or article-level
// fallback: SQL returns bounded daily totals, not the full Galaxy corpus.
async function scopeStatisticsRows(scope,{startDate='',endDate='',includeUndated=false}={}){
  const current=scopeOf(scope);
  if(usesNumericIsr(current.id)){
    try{return await readNumericIsr(current.id,'culture',{startDate,endDate,includeUndated});}
    catch{ /* Optional ISR cache failure: query the primary Kysely aggregate. */ }
  }
  return cachedReadScopeStatistics(current.id,{
    startDate:dateOnly(startDate),endDate:dateOnly(endDate),includeUndated
  });
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

// Per-Scope daily category counts for text works and media, computed by the
// database. includeEmptyMedia keeps media rows without a type; includeUndated
// keeps rows without a date (their day is '').
export async function selectScopeDailyCounts(scope,{startDate='',endDate='',includeEmptyMedia=false,includeUndated=false,requireAggregate=false}={}){
  const current=scopeOf(scope);
  const counted=await scopeStatisticsRows(current,{startDate,endDate,includeUndated});
  const order=(a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category);
  if(counted){
    const pick=kind=>counted.filter(row=>row.kind===kind&&(kind==='source'||includeEmptyMedia||row.category))
      .map(row=>({day:row.day,category:row.category,item_count:Number(row.item_count)||0})).sort(order);
    return {text:pick('source'),media:pick('media')};
  }
  // Both public Culture and Statistics must rely on the grouped DB reader.
  // Never silently stream all Galaxy/media rows in a browser fallback.
  throw new Error('Culture requires a database-side date aggregate; full-row fallback disabled');
}

// One number per source/media category for a window, no per-day grouping
// (silver.read_scope_category_totals). This is what a collapsed Culture
// river lane needs to size its flat water-level bar; the full day x
// category aggregate (selectScopeDailyCounts) is only fetched once a lane
// is expanded.
export async function selectScopeCategoryTotals(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const rows=await cachedReadScopeCategoryTotals(current.id,{startDate:dateOnly(startDate),endDate:dateOnly(endDate)});
  const pick=kind=>rows.filter(row=>row.kind===kind)
    .map(row=>({category:row.category,item_count:Number(row.item_count)||0}))
    .filter(row=>row.item_count>0);
  return {text:pick('source'),media:pick('media')};
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

export async function selectDailyCategoryCounts(table,categoryColumn,{startDate='',endDate='',filters=[],includeEmpty=false,includeUndated=false}={}){
  const match=String(table||'').match(/^(?:silver\.)?([a-z][a-z0-9]*)_galaxy(_media)?$/);
  const kind=match?.[2]?'media':'source';
  if(!match||!(kind==='media'?['type','media_type'].includes(categoryColumn):categoryColumn==='site')||filters.length)
    throw new Error('Unsupported daily category request; row-streaming fallback is disabled');
  const rows=await cachedReadScopeStatistics(match[1],{
    startDate:dateOnly(startDate),endDate:dateOnly(endDate),includeUndated
  });
  return rows.filter(item=>item.kind===kind&&(includeEmpty||item.category))
    .map(item=>({day:String(item.day||''),category:String(item.category||''),
      item_count:Number(item.item_count)||0}))
    .sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
}

async function selectCategoryCountsRaw(table,categoryColumn,{startDate='',endDate='',filters=[],limit=20}={}){
  // Use the installed DB-side category aggregate; never stream every article.
  const match=String(table||'').match(/^silver\.([a-z][a-z0-9]*)_galaxy(_media)?$/);
  const media=Boolean(match?.[2]);
  if(!match||!(media?['type','media_type'].includes(categoryColumn):categoryColumn==='site')||filters.length)
    return [];
  const rows=await cachedReadScopeCategoryTotals(match[1],{
    startDate:dateOnly(startDate),endDate:dateOnly(endDate)
  });
  return rows.filter(row=>row.kind===(media?'media':'source')&&String(row.category||'').trim())
    .map(row=>({term:String(row.category).trim(),item_count:Number(row.item_count)||0}))
    .sort((a,b)=>b.item_count-a.item_count||a.term.localeCompare(b.term));
}

function mediaIdsOf(value){
  return [...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))];
}
async function mediaRowsFor(scope,mediaIds=[],{signal=null,includeLegacyRuneRefs=false}={}){
  const current=scopeOf(scope);
  const ids=[...new Set(mediaIds.map(String).filter(Boolean))];
  if(!ids.length)return [];
  const result=[];
  for(let i=0;i<ids.length;i+=40){
    const batch=ids.slice(i,i+40);
    const page=await selectRows(current.galaxyMedia,{
      columns:'uid,title,url,type,description',
      filters:[{column:'uid',operator:'in',value:batch}],
      limit:batch.length,maxLimit:batch.length,signal
    });
    result.push(...page.rows);
  }
  return result;
}
function resolvedLinks(row,mediaById){
  const links=[];
  if(row?.url&&/^https?:\/\//i.test(String(row.url)))links.push({id:'url:'+row.uid,href:row.url,label:'外部連結'});
  for(const id of mediaIdsOf(row?.media_link)){
    const media=mediaById.get(id);
    if(media?.url&&/^https?:\/\//i.test(String(media.url))){
      links.push({id:'media:'+id,href:media.url,label:media.title||media.type||'媒體連結'});
    }
  }
  return links;
}

export async function resolveGalaxyExternalLinks(scope,rows=[],{signal=null}={}){
  const current=scopeOf(scope);
  const source=Array.isArray(rows)?rows:[];
  if(!source.length)return [];
  const ids=[...new Set(source.flatMap(row=>mediaIdsOf(row?.media_link)))];
  const mediaRows=await mediaRowsFor(current,ids,{signal});
  const mediaById=new Map(mediaRows.map(item=>[String(item.uid),item]));
  return source.map(row=>({...row,resolved_links:resolvedLinks(row,mediaById)}));
}

export async function selectGalaxyContent(scope,uid,{authenticated=false,dbId=''}={}){
  const current=scopeOf(scope);
  const id=String(uid||'').trim();
  if(!id)return null;
  // A single-article read uses the complete GalaxyUidRead projection. The
  // caller may still consume only `content`, but relation/anchor context is
  // no longer silently lost at this boundary.
  return selectRowById(current.galaxy,{idColumn:'uid',id,
    columns:galaxyUidReadColumns().join(','),authenticated,expectedDbId:dbId});
}

async function relatedArticleTitlesFor(scope,row,{includeHidden=false,dbId=''}={}){
  const ids=[...new Set([row.source_id,row.ref_id,...(normalizeRelationIds(row.target_id)||[])]
    .map(value=>String(value||'').trim()).filter(Boolean))];
  if(!ids.length)return {};
  const batches=[];
  for(let i=0;i<ids.length;i+=50)batches.push(ids.slice(i,i+50));
  const pages=await mapBounded(batches,3,async batch=>{
    const {rows=[]}=await selectRows(scope.galaxy,{
      columns:galaxyListColumns().join(','),
      filters:[{column:'uid',operator:'in',value:batch},
        ...(!includeHidden?[articlePermissionFilter(scope,'list')]:[])],
      orFilter:'',
      limit:batch.length,
      authenticated:includeHidden,expectedDbId:dbId
    });
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
  const promise=import('./culture-query')
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
  const dateAnchors=rows.filter(row=>row.entry_type==='anchor');
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
    // LOC's four legacy relations were consolidated into _anchor. The shared
    // Trace reader projects native attr.point/attr.path without relying on
    // removed trace_type, anchor_list or route_list physical columns.
    const [pointPage,maps]=await Promise.all([
      selectRows('silver.'+scope.id+'_anchor',{columns:'uid,type,title',
        filters:[{column:'uid',operator:'eq',value:placeId},
          {column:'type',operator:'eq',value:'point'}],
        limit:1,authenticated}),
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
  const {rows:articleRows}=await selectRows(current.galaxy,{
    // GalaxyUidRead is the article detail projection. The separate attr
    // flags are fetched only as the existing visibility guard's input.
    columns:galaxyUidReadWithPolicyColumns().join(','),
    filters:[{column:'uid',operator:'eq',value:id},
      ...(!includeHidden?[articlePermissionFilter(current,'list')]:[])],
    orFilter:'',
    limit:1,authenticated:includeHidden,expectedDbId:dbId
  });
  const row=articleRows[0]||null;
  if(!row||(!includeHidden&&galaxyAble(row).list===false))return null;
  const mediaIds=mediaIdsOf(row.media_link);
  const placeId=String(row.place_id||'').trim();
  const day=articleDate(row.date);
  const [relationTitles,mediaRows,space,time,statistics]=await Promise.all([
    relatedArticleTitlesFor(current,row,{includeHidden,dbId:federated?dbId:''}).catch(()=>({})),
    // A federated Galaxy row may live in another database with independent
    // Anchor/Media/Time UIDs. Until those readers accept a qualified dataset,
    // never attach unrelated primary-DB metadata to this article.
    federated?Promise.resolve([]):mediaRowsFor(current,mediaIds).catch(()=>[]),
    federated?Promise.resolve({place:null,routes:[],traces:[]}):
      articleSpaceContext(current,placeId,{authenticated:includeHidden}).catch(()=>({place:null,routes:[],traces:[]})),
    federated?Promise.resolve({anchors:[],periods:[],eras:[]}):
      articleTimeContext(current,day).catch(()=>({anchors:[],periods:[],eras:[]})),
    articleStatisticsContext(current,day)
  ]);
  const mediaById=new Map(mediaRows.map(item=>[String(item.uid),item]));
  const orderedMedia=mediaIds.map(mediaId=>mediaById.get(mediaId)).filter(Boolean);
  // Existing 2026 records sometimes stored card spreads on non-rune media.
  // Expose them as a read-only rune media view until the verified data backfill;
  // do not modify or duplicate any Galaxy article in a read request.
  // Keep media and original article URLs as distinct associations.
  return {...row,scope_id:current.id,__db_id:dbId||row.__db_id||'',__table:current.galaxy,
    links:resolvedLinks(row,new Map()),relation_titles:relationTitles,
    related_media:orderedMedia,trace_place:space.place,
    related_space:space,related_time:time,related_statistics:statistics,
    article_day:day};
}

function literalPattern(value){
  return '%'+String(value||'').trim().replace(/\\/g,'\\\\').replace(/%/g,'\\%').replace(/_/g,'\\_')+'%';
}
function orExpression(fields,term){
  const literal=portableContainsTerm(term);
  return fields.map(field=>field+'.contains."'+literal+'"').join(',');
}
function applyParsedTerms(query,fields,parsed,and=[],nor=[]){
  const groups=(parsed.groups.length?parsed.groups:[[]]).map(group=>unique([...group,...and])).filter(group=>group.length);
  if(groups.length===1){
    for(const term of groups[0])query=query.or(orExpression(fields,term));
  }else if(groups.length>1){
    query=query.or(groups.map(group=>'and('+group.map(term=>'or('+orExpression(fields,term)+')').join(',')+')').join(','));
  }
  for(const term of unique([...parsed.excludes,...nor])){
    for(const field of fields)query=query.not(field,'contains',term);
  }
  return query;
}
function dateSearchFilters(dateColumn,startDate,endDate){
  const filters=[];
  if(dateColumn&&startDate)filters.push({column:dateColumn,operator:'gte',value:dateColumn==='createtime'?startDate+'T00:00:00+08:00':startDate});
  if(dateColumn&&endDate)filters.push({column:dateColumn,operator:'lte',value:dateColumn==='createtime'?endDate+'T23:59:59.999+08:00':endDate});
  return filters;
}
function recordFor(row,source,providerId,scope,table){
  return {row:{...row,scope_id:row?.scope_id||scope.id,__table:table,__galaxy_media_table:scope.galaxyMedia},source,providerId};
}

function makeProvider({id,table,source,scope,idColumn,columns,searchFields,filters=[],dateColumn='',exactColumn='',batchSize=DEFAULT_LIST_BATCH_SIZE,sourceClause='',authenticated=false,uidFastPath=false}){
  const outputColumns=Object.freeze(unique(columns));
  const frozenFields=Object.freeze(unique(searchFields));
  const frozenFilters=Object.freeze(filters.map(item=>Object.freeze({...item})));
  const pageSize=Math.max(1,Math.min(100,Math.floor(Number(batchSize)||DEFAULT_LIST_BATCH_SIZE)));
  return Object.freeze({
    id,table,source,scope,idColumn,columns:outputColumns,searchFields:frozenFields,filters:frozenFilters,
    async search(query,{cursor=0,startDate='',endDate='',and=[],nor=[],source='auto',browse=false,signal=null,sortDirection='asc'}={}){
      const offset=Math.max(0,Math.floor(Number(cursor)||0));
      const activeTable=table;
      const parsed=parseSearchQuery(query);
      // Exact-match stages only apply to a plain keyword or a single "quoted phrase".
      if(!browse&&exactColumn&&!parsed.exact)return {rows:[],hasMore:false,nextCursor:null,totalCount:null,dataSource:source||'auto'};
      const activeFilters=[...frozenFilters,...dateSearchFilters(dateColumn,startDate,endDate)];
      if(uidFastPath&&!browse&&/^[A-Za-z0-9]{8}$/.test(String(query||'').trim())){
        // Authenticated UID primary-key lookup, independent of public search flags.
        const {rows=[],dataSource}=await selectRows(table,{
          columns:outputColumns.join(','),
          filters:[{column:idColumn,operator:'eq',value:String(query).trim()}],
          limit:1,authenticated,signal
        });
        return {rows:rows.map(row=>recordFor(row,source,id,scope,table)),
          hasMore:false,nextCursor:null,totalCount:null,dataSource};
      }
      const ascending=sortDirection!=='desc';
      const orders=[
        ...(dateColumn?[{column:dateColumn,ascending}]:[]),
        // Opaque UIDs are only a deterministic tie-breaker, never a date.
        {column:idColumn,ascending:true}
      ];

      // The exact COUNT(*) query can time out on ILIKE against article content.
      // Fetch one extra row instead; ordinary searching never needs a total count.
      const dataResult=await executePublicRead(activeTable,relation=>{
        let dataQuery=relation.select(outputColumns.join(','));
        dataQuery=applyFilters(dataQuery,activeFilters);
        if(sourceClause)dataQuery=dataQuery.or(sourceClause);
        if(!browse&&exactColumn){
          const exact=literalPattern(parsed.exact).slice(1,-1);
          dataQuery=dataQuery.ilike(exactColumn,exact);
        }else if(!browse)dataQuery=applyParsedTerms(dataQuery,frozenFields,parsed,and,nor);
        dataQuery=applyOrders(dataQuery,orders);
        return dataQuery.range(offset,offset+pageSize-1);
      },{source,authenticated,signal});
      const dataSource=dataResult.__dataSource||source||'auto';
      const found=dataResult.data||[];
      // A full page may have a successor; only the next requested page probes it.
      const hasMore=found.length===pageSize;
      const rows=found.slice(0,pageSize).map(row=>recordFor(row,source,id,scope,activeTable));
      const nextOffset=offset+rows.length;
      return {rows,hasMore,nextCursor:hasMore?nextOffset:null,totalCount:null,dataSource};
    }
  });
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
function sourceNameClause(selection){
  if(selection.kind==='all')return '';
  // JSON string quoting keeps PostgREST's OR grammar intact for unusual
  // administrator-configured source names (commas, quotes and parentheses).
  const item=name=>'site.ilike.'+
    JSON.stringify(String(name).replace(/[\\%_*]/g,match=>'\\'+match));
  if(selection.kind==='names')return selection.names.map(item).join(',');
  if(selection.kind==='others'){
    if(!selection.names.length)return '';
    return 'site.is.null,and('+selection.names.map(name=>
      item(name).replace('site.ilike.','site.not.ilike.')
    ).join(',')+')';
  }
  return '';
}

// Management is a separate article query, not the public Search provider
// cascade. It uses only the authorized Scope's Galaxy table, including rows
// with searchable=false, and does not scan unrelated Media/Time tables.
function managementArticleProviders(scope,{contentType='',sourceFilter='',sourceTaxonomy=null,placeOnly=false}={}){
  const selection=resolveSourceSelection(sourceFilter,sourceTaxonomy||{});
  if(selection.kind==='none')return [];
  const current=scopeOf(scope);
  const filters=[
    ...(contentType==='lyrics_work'?[{column:'site',operator:'ilike',value:'suno'}]:[]),
    ...(contentType==='text_work'?[{column:'site',operator:'neq',value:'suno'}]:[])
  ];
  const base={
    table:current.galaxy,source:current.id+' 文章',scope:current,idColumn:'uid',
    // Every article list uses the same ZModel read projection. Visibility
    // flags are part of GalaxyList, never a second ad-hoc column list.
    columns:galaxyListColumns().join(','),dateColumn:dayColumn(current.galaxy),filters,sourceClause:sourceNameClause(selection),
    authenticated:true
  };
  if(placeOnly)return [makeProvider({
    ...base,id:current.id+':management-place',searchFields:['location']
  })];
  // Management searches article body content only. Exact UID remains an
  // explicit identity lookup, not a title-search mode.
  return [makeProvider({
    ...base,id:current.id+':management-content',searchFields:['content']
  })];
}

function genericScopeProviders(scope,{includeHiddenText=false,contentType='',sourceFilter='',sourceTaxonomy=null}={}){
  const selection=resolveSourceSelection(sourceFilter,sourceTaxonomy||{});
  if(selection.kind==='none')return [];
  const current=scopeOf(scope);
  const kindFilters=[
    ...(contentType==='lyrics_work'?[{column:'site',operator:'ilike',value:'suno'}]:[]),
    ...(contentType==='text_work'?[{column:'site',operator:'neq',value:'suno'}]:[])
  ];
  const textFilters=includeHiddenText
    ?kindFilters
    :publicContentFilters([searchPermissionFilter(current),...kindFilters]);
  // Search rows are still article lists: content is searched server-side but
  // the returned shape is the same GalaxyList projection.
  const textColumns=galaxyListColumns();
  // Search uses only the article service: Galaxy.content. Anchor is
  // resolved through article relationships, never queried as a reverse index.
  if(contentType&&!['galaxy','lyrics_work','text_work'].includes(contentType))
    return [];
  const article=makeProvider({
    id:current.id+':article-content',table:current.galaxy,
    source:current.id+' 文章',scope:current,idColumn:'uid',
    columns:textColumns,searchFields:['content'],dateColumn:dayColumn(current.galaxy),
    filters:textFilters,sourceClause:sourceNameClause(selection),authenticated:includeHiddenText
  });
  return [article];
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

export async function searchGalaxyRows(scopes,query,{
  limit=DEFAULT_LIST_BATCH_SIZE,cursor=null,startDate='',endDate='',and=[],nor=[],hiddenScopeIds=[],contentType='',sourceFilter='',sourceTaxonomy=null,placeOnly=false,browse=false,signal=null,sortDirection='asc',managementOnly=false
}={}){
  const q=String(query||'').trim();
  if(!q&&!browse)return {rows:[],failures:[],hasMore:false,nextCursor:null};
  const safeLimit=Math.max(1,Math.min(DEFAULT_LIST_BATCH_SIZE,Math.floor(Number(limit)||DEFAULT_LIST_BATCH_SIZE)));
  const scopeList=(Array.isArray(scopes)?scopes:[]).filter(scope=>scope?.id);
  const hiddenScopes=new Set((Array.isArray(hiddenScopeIds)?hiddenScopeIds:[]).map(value=>String(value||'').trim()).filter(Boolean));
  const scopeProviders=scopeList.map(scope=>managementOnly
    ?managementArticleProviders(scope,{contentType,sourceFilter,sourceTaxonomy,placeOnly})
    :genericScopeProviders(scope,{includeHiddenText:hiddenScopes.has(scope.id),contentType,sourceFilter,sourceTaxonomy}));
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
    const uid=String(row?.uid||'').trim();
    const scope=scopeMap.get(row?.scope_id);
    if(!uid||!scope?.galaxy)continue;
    const dbId=String(row.__db_id||'');
    const key=JSON.stringify([scope.id,dbId]);
    if(!batches.has(key))batches.set(key,{scope,dbId,ids:new Set()});
    batches.get(key).ids.add(uid);
  }
  const metadata=new Map();
  await mapBounded([...batches.values()],3,async({scope,dbId,ids})=>{
    const keys=[...ids];
    if(keys.length>DEFAULT_LIST_BATCH_SIZE)throw new Error('Search page exceeds bounded UID limit');
    const {rows}=await selectRows(scope.galaxy,{
      columns:galaxyListColumns().join(','),
      filters:[{column:'uid',operator:'in',value:keys}],
      limit:keys.length,
      authenticated:privateScopes.has(scope.id),
      expectedDbId:dbId,signal
    });
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
/**
 * Media facet aggregation reads only the selected Scope's narrow metadata columns,
 * in bounded DB pages. It never fetches media binary or Galaxy body content.
 * For large installations, a DB-side GROUP BY/RPC can replace this adapter
 * without changing the facet response contract.
 */

async function selectMediaStatisticsFacetRowsRaw(scope,dimension,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  if(!['media_type','media_platform','media_style'].includes(dimension)){
    throw new Error('Unknown media statistics dimension');
  }
  // Only the numbers for public charts are persisted in server ISR.
  // Advanced Style cross-tag relationships still require their own raw metadata.
  if(usesNumericIsr(current.id)){
    try{return await readNumericIsr(current.id,'facet',{startDate,endDate,dimension});}
    catch{ /* Optional ISR failure: aggregate existing metadata. */ }
  }
  const filters=timeFilters('createtime',startDate,endDate);
  const columns='uid,type,url,description,createtime';
  const orders=[{column:'type',ascending:true}];
  const aggregates=new Map();
  let offset=0,total=null,source='auto';
  while(total===null||offset<total){
    const page=await selectRows(current.galaxyMedia,{
      columns,filters,orders,limit:DB_QUERY_BATCH_SIZE,offset,
      count:offset===0?'exact':null,source
    });
    if(offset===0)total=Number.isFinite(Number(page.count))?Number(page.count):page.rows.length;
    source=page.dataSource||source;
    for(const row of StatisticsFacets.base.mediaFacetDaily(page.rows,dimension)){
      const key=row.day+'\u0000'+row.category.normalize('NFKC').toLocaleLowerCase();
      const existing=aggregates.get(key);
      if(existing)existing.item_count+=row.item_count;
      else aggregates.set(key,{...row});
    }
    if(!page.rows.length)break;
    offset+=page.rows.length;
  }
  return [...aggregates.values()].sort((a,b)=>
    a.day.localeCompare(b.day)||a.category.localeCompare(b.category)
  );
}

// Cross-tag comparisons must retain each media item's own metadata.
// Daily facet aggregates cannot reconstruct which tags belonged to the same item.
export async function selectMediaCrossTagRows(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const filters=timeFilters('createtime',startDate,endDate);
  const orders=[{column:'type',ascending:true}];
  const rows=[];
  let offset=0,total=null,source='auto';
  while(total===null||offset<total){
    const page=await selectRows(current.galaxyMedia,{
      columns:'uid,description,createtime',
      filters,orders,limit:DB_QUERY_BATCH_SIZE,offset,
      count:offset===0?'exact':null,source
    });
    if(offset===0)total=Number.isFinite(Number(page.count))?Number(page.count):page.rows.length;
    source=page.dataSource||source;
    rows.push(...page.rows);
    if(!page.rows.length)break;
    offset+=page.rows.length;
  }
  return rows;
}


export async function selectMediaCrossPairWorks(scope,pair,{
  startDate='',endDate='',offset=0,limit=10
}={}){
  const current=scopeOf(scope);
  if(!pair?.leftLabel||!pair?.rightLabel)return {rows:[],nextOffset:0,hasMore:false};
  const safeLimit=Math.max(1,Math.min(50,Math.floor(Number(limit)||10)));
  const batchSize=Math.max(20,safeLimit*2);
  const escapeLike=value=>String(value).replace(/[\\%_]/g,'\\$&');
  const filters=[
    ...timeFilters('createtime',startDate,endDate),
    {column:'description',operator:'ilike',value:'%'+escapeLike(pair.leftLabel)+'%'},
    {column:'description',operator:'ilike',value:'%'+escapeLike(pair.rightLabel)+'%'}
  ];
  const left=String(pair.left||'').normalize('NFKC').toLocaleLowerCase();
  const right=String(pair.right||'').normalize('NFKC').toLocaleLowerCase();
  const rows=[];
  let cursor=Math.max(0,Math.floor(Number(offset)||0));
  let source='auto';
  while(true){
    const page=await selectRows(current.galaxyMedia,{
      columns:'uid,title,url,description,createtime',
      filters,orders:[{column:'type',ascending:true}],
      limit:batchSize,offset:cursor,source
    });
    source=page.dataSource||source;
    if(!page.rows.length)return {rows,nextOffset:cursor,hasMore:false};
    for(const row of page.rows){
      const rowOffset=cursor++;
      const tags=new Set(StatisticsFacets.base.mediaStyleTags(row.description).map(tag=>tag.normalize('NFKC').toLocaleLowerCase()));
      if(!tags.has(left)||!tags.has(right))continue;
      rows.push({id:String(row.uid),title:String(row.title||''),url:String(row.url||''),day:StatisticsFacets.base.mediaDay(row.createtime)});
      if(rows.length>safeLimit){
        return {rows:rows.slice(0,safeLimit),nextOffset:rowOffset,hasMore:true};
      }
    }
    if(page.rows.length<batchSize)return {rows,nextOffset:cursor,hasMore:false};
  }
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
  return (await mapBounded(Array.isArray(scopes)?scopes:[],2,scope=>scopeDensityRows(scope,range)))
    .flat()
    .sort((a,b)=>a.day.localeCompare(b.day)||a.scope_id.localeCompare(b.scope_id));
}

// Single-row ordered probes: determine the first *actual* statistic item
// without loading the full corpus or inventing a historical year ceiling.
export async function selectFirstScopeStatisticsDate(scope){
  const current=scopeOf(scope);
  const text=await selectRows(current.galaxy,{
    columns:dayColumn(current.galaxy),
    filters:publicContentFilters([articlePermissionFilter(current,'culture')]),
    orders:[{column:dayColumn(current.galaxy),ascending:true,nullsFirst:false}],
    limit:1
  });
  const dates=(text.rows||[]).map(row=>String(row[dayColumn(current.galaxy)]||'').slice(0,10))
    .filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day));
  return dates[0]||'';
}

// One request per chart. The database returns the earliest date, the exact daily
// counts and the small source taxonomy together; the row-level readers below only
// serve while the functions are not installed (for example on a backup database).
async function selectScopeOverviewRaw(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  if(usesNumericIsr(current.id)){
    try{
      const snapshot=await readNumericIsr(current.id,'statistics',{startDate,endDate});
      // Statistics now contains only dated Galaxy source counts. Multimedia is
      // a Keyword Class, never an additional overview statistic. Accept a
      // complete current ISR snapshot without triggering duplicate SQL reads.
      if(typeof snapshot?.earliest==='string'&&Array.isArray(snapshot.rows)&&
         Array.isArray(snapshot.categories)&&Array.isArray(snapshot.aliases))
        return snapshot;
    }catch{ /* Optional ISR cache failure: query Kysely. */ }
  }
  return readScopeOverview(current.id,{startDate,endDate});
}
async function selectScopeEarliestRaw(scope){
  const current=scopeOf(scope);
  if(usesNumericIsr(current.id)){
    try{return await readNumericIsr(current.id,'earliest');}
    catch{ /* Optional ISR cache failure: query Kysely. */ }
  }
  return readScopeEarliest(current.id);
}
async function selectLocStatisticsRaw({startDate='',endDate=''}={}){
  if(usesNumericIsr('loc')){
    try{return await readNumericIsr('loc','loc-statistics',{startDate,endDate});}
    catch{ /* Optional ISR cache failure: query Kysely. */ }
  }
  return readLocStatistics({startDate,endDate});
}

// Separate source and media breakdowns. These are independently
// chosen within the current Scope; no cross-Scope read or merged corpus.
export async function selectScopeSourceBreakdownRows(scope,{startDate='',endDate=''}={}){
  const current=scopeOf(scope);
  const counted=await scopeStatisticsRows(current,{startDate,endDate});
  if(counted)return counted;
  // Statistics must never fetch all article/media rows into the browser
  // to recreate a daily aggregate. An unavailable DB aggregate is an error.
  throw new Error('Scope statistics aggregate unavailable; full-row fallback disabled');
}

export async function selectSourceTrendRows(scopes,{startDate='',endDate=''}={}){
  const range={startDate:dateOnly(startDate),endDate:dateOnly(endDate)};
  const rows=(await mapBounded(Array.isArray(scopes)?scopes:[],3,scope=>scopeSourceTrendRows(scope,range))).flat();
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
export const selectMediaStatisticsFacetRows=emptyOnFailure(selectMediaStatisticsFacetRowsRaw,[]);
export const selectScopeDensityRows=emptyOnFailure(selectScopeDensityRowsRaw,[]);
// A failed Statistics overview is a query failure, never a legitimate zero chart.
// Let useAsyncResource display the actual request error and its retry action.
export const selectScopeOverview=selectScopeOverviewRaw;
export const selectScopeEarliest=emptyOnFailure(selectScopeEarliestRaw,'');
export const selectLocStatistics=emptyOnFailure(selectLocStatisticsRaw,{earliest:'',scopes:[],rows:[]});
