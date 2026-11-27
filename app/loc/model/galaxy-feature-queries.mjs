import {ARTICLE_UID_PAGE_ROWS} from '../query/query-batch-size.mjs';
// Four fixed Galaxy feature models. Query structure and physical relation are
// selected only by this server module, never by a browser SQL expression.
import {z} from 'zod';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {galaxyReadColumns,galaxyReadColumnsFor}
  from '../../../packages/zenstack/galaxy-read-models.mjs';
import {parseSearchQuery} from '../search/query.mjs';
import {readAdaptiveSqlPages} from '../query/adaptive-sql-read.mjs';
import {mapBounded} from '../query/bounded-parallel.mjs';

export const GALAXY_FEATURE_MODELS=Object.freeze({
  culture:Object.freeze({flag:'culture',name:'GalaxyCulture'}),
  statics:Object.freeze({flag:'statics',name:'GalaxyStatistics'}),
  search:Object.freeze({flag:'search',name:'GalaxySearch'}),
  trace:Object.freeze({flag:'trace',name:'GalaxyTrace'}),
  list:Object.freeze({flag:'list',name:'GalaxyList'}),
  keyword:Object.freeze({flag:'keyword',name:'GalaxyKeyword'}),
  extract:Object.freeze({flag:'extract',name:'GalaxyExtract'}),
  others:Object.freeze({flag:'others',name:'GalaxyOthers'})
});
const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&
  row.scope_id!=='loc'&&row.scope_id!=='admin').map(row=>row.scope_id));
const featureFields=new Set(galaxyReadColumns('GalaxyAttr'));
if(Object.values(GALAXY_FEATURE_MODELS).some(model=>!featureFields.has(model.flag)))
  throw Error('Missing physical Galaxy ZModel feature flag');

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UID=z.string().regex(/^[A-Za-z0-9]{8}$/);
const PLACE_ID=z.string().regex(/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/);
const source=z.string().trim().min(1).max(120);
const category=z.discriminatedUnion('type',[
  z.object({type:z.literal('source'),value:source}).strict(),
  z.object({type:z.literal('place'),value:PLACE_ID}).strict(),
  // A literal substring, not a Keyword Class/Item/Pattern analysis.
  z.object({type:z.literal('keyword'),value:z.string().trim().min(2).max(80)}).strict()
]);
const input=z.object({
  kind:z.literal('query'),operation:z.literal('galaxy-feature'),
  feature:z.enum(['culture','statics','search','trace','list','keyword','extract','others']),
  scope:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  startDate:date.optional(),endDate:date.optional(),category:category.optional(),
  sources:z.array(source).min(1).max(80).optional(),
  excludedSources:z.array(source).min(1).max(80).optional(),
  placeIds:z.array(PLACE_ID).min(1).max(800).optional(),
  mediaUrls:z.array(z.string().url().max(1024)).min(1).max(80).optional(),
  // Search expression supports ordinary terms, quoted phrases, OR, exclusions.
  text:z.string().trim().min(1).max(160).optional(),
  requiredTerms:z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  excludedTerms:z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  result:z.enum(['count','daily','daily-sources','sources','uids','articles','earliest']),
  cursor:UID.optional(),offset:z.number().int().min(0).max(10000).optional(),
  sortDirection:z.enum(['asc','desc']).optional(),
  includeTotal:z.boolean().optional(),orderByDate:z.boolean().optional(),
  limit:z.number().int().min(1).max(ARTICLE_UID_PAGE_ROWS).optional()
}).strict();
function validDate(s){
  const v=new Date(s+'T00:00:00Z');
  return !Number.isNaN(v.getTime())&&v.toISOString().slice(0,10)===s;
}
export function parseGalaxyFeatureQuery(raw){
  const parsed=input.safeParse(raw);
  if(!parsed.success)throw Object.assign(Error('Invalid Galaxy feature model'),{httpStatus:400});
  const value=parsed.data;
  if(!published.has(value.scope)&&!(value.scope==='loc'&&
      value.feature==='statics'&&value.result==='daily-sources'&&
      value.sources?.length>0)||
    value.startDate!==undefined&&!validDate(value.startDate)||
    value.endDate!==undefined&&!validDate(value.endDate)||
    value.startDate&&value.endDate&&value.startDate>value.endDate||
    (value.cursor!==undefined&&value.result!=='uids')||
    (value.offset!==undefined&&value.result!=='articles')||
    (value.sortDirection!==undefined&&value.result!=='articles')||
    (value.includeTotal!==undefined&&value.result!=='articles')||
    (value.orderByDate!==undefined&&value.result!=='articles')||
    (value.limit!==undefined&&!['uids','articles'].includes(value.result))||
    (value.text||value.requiredTerms||value.excludedTerms)&&value.feature!=='search'||
    value.placeIds&&value.category?.type==='place'||
    value.mediaUrls&&value.feature!=='trace'||
    // Public Search only exposes text in title/content. Other features retain
    // their own internal exact Source/Place selectors.
    value.feature==='search'&&(
      value.sources!==undefined||value.excludedSources!==undefined||
      value.placeIds!==undefined||
      ['source','place'].includes(value.category?.type)))
    throw Object.assign(Error('Invalid Galaxy feature parameters'),{httpStatus:400});
  return {...value,limit:['uids','articles'].includes(value.result)?value.limit||ARTICLE_UID_PAGE_ROWS:undefined};
}
export const PUBLIC_GALAXY_PRIVATE_SITES=Object.freeze(['messenger','chatgpt','claude','gemini',
  'msn','whatsapp','telegram','discord','line','wechat','teams','copilot',
  'grok','perplexity','meta ai','meta-ai','github','mcp']);
// Text terms are SQL *values* only. Escape LIKE wildcard syntax so the
// search grammar cannot accidentally become a pattern-language SQL API.
const pattern=value=>'%'+String(value).replace(/[\\%_]/g,x=>'\\'+x)+'%';
function baseQuery(db,model){
  let q=db.selectFrom('silver.'+model.scope+'_galaxy')
    .where(GALAXY_FEATURE_MODELS[model.feature].flag,'=',true)
    .where(eb=>eb.or([eb('site','is',null),
      eb(eb.fn('lower',['site']),'not in',PUBLIC_GALAXY_PRIVATE_SITES)]));
  if(model.startDate)q=q.where('date','>=',model.startDate);
  if(model.endDate)q=q.where('date','<=',model.endDate);
  const selector=model.category;
  if(selector?.type==='source')q=q.where('site','=',selector.value);
  if(selector?.type==='place')q=q.where('place_id','=',selector.value);
  if(model.sources)q=q.where(eb=>eb(
    eb.fn('lower',['site']),'in',model.sources.map(name=>name.toLowerCase())
  ));
  if(model.excludedSources)q=q.where(eb=>eb.or([
    eb('site','is',null),
    eb(eb.fn('lower',['site']),'not in',
      model.excludedSources.map(name=>name.toLowerCase()))
  ]));
  if(model.placeIds)q=q.where('place_id','in',model.placeIds);
  if(model.mediaUrls)q=q.where('media_link','&&',model.mediaUrls);
  if(selector?.type==='keyword'){
    if(model.feature!=='search')q=q.where('keyword','=',true);
    q=q.where('content','is not',null).where('content','ilike',pattern(selector.value));
  }
  // Each search term matches only article title OR body content. Never treat
  // site/location/metadata as searchable text, even with direct API calls.
  const textMatch=(eb,term)=>eb.or([
    eb('title','ilike',pattern(term)),
    eb('content','ilike',pattern(term))
  ]);
  const textExclude=(eb,term)=>eb.and(['title','content'].map(column=>
    eb.or([eb(column,'is',null),eb(column,'not ilike',pattern(term))])));
  if(model.text){
    const parsed=parseSearchQuery(model.text);
    if(!parsed.groups.length&&parsed.excludes.length===0)
      throw Object.assign(Error('Empty Search terms'),{httpStatus:400});
    if(parsed.groups.length>6||parsed.groups.some(group=>group.length>8)||
       parsed.excludes.length>8)
      throw Object.assign(Error('Search term budget exceeded'),{httpStatus:400});
    if(parsed.groups.length)
      q=q.where(eb=>eb.or(parsed.groups.map(group=>eb.and(
        group.map(term=>textMatch(eb,term))))));
    for(const term of parsed.excludes)
      q=q.where(eb=>textExclude(eb,term));
  }
  for(const term of model.requiredTerms||[])
    q=q.where(eb=>textMatch(eb,term));
  for(const term of model.excludedTerms||[])
    q=q.where(eb=>textExclude(eb,term));
  if(model.feature==='extract')q=q.where('list','=',true);
  if(['uids','articles'].includes(model.result)){
    q=q.where('list','=',true);
    if(model.feature==='search')
      q=q.where(eb=>eb.or([
        eb('title','is not',null),eb('content','is not',null)
      ]));
  }
  return q;
}
export async function executeGalaxyFeatureQuery(db,model){
  if(model.scope==='loc'){
    // LOC-wide media statistics use this feature action's already-authorized
    // direct connection. Each Scope projection is an independent SELECT;
    // there is no read transaction. Scope identifiers come from published JS.
    const sums=new Map();
    const results=await mapBounded([...published],scope=>
      executeGalaxyFeatureQuery(db,{...model,scope}));
    for(const result of results){
      for(const row of result.rows){
        if(row.kind!=='source')continue;
        const key=row.day+'\u0000'+row.category;
        sums.set(key,(sums.get(key)||0)+Number(row.item_count||0));
      }
    }
    const rows=[...sums].map(([key,item_count])=>{
      const split=key.indexOf('\u0000');
      return {day:key.slice(0,split),kind:'source',
        category:key.slice(split+1),item_count};
    }).sort((a,b)=>a.day.localeCompare(b.day)||
      a.category.localeCompare(b.category));
    return {rows};
  }
  const q=baseQuery(db,model);
  if(model.result==='earliest'){
    const row=await q.select(eb=>eb.fn.min('date').as('earliest')).executeTakeFirst();
    return {earliest:row?.earliest||null};
  }
  if(model.result==='count'){
    const row=await q.select(eb=>eb.fn.countAll().as('total')).executeTakeFirst();
    return {total:Number(row?.total||0)};
  }
  if(model.result==='daily'){
    const days=new Map();
    await readAdaptiveSqlPages({
      countRows:async()=>Number((await q
        .select(eb=>eb.fn.countAll().as('row_count')).executeTakeFirst())?.row_count||0),
      fetchPage:({offset,limit})=>q.select(['date','createtime'])
        .orderBy('createtime','asc').limit(limit).offset(offset).execute(),
      consumePage:rows=>{
        for(const row of rows){
          const day=row.date instanceof Date?row.date.toISOString().slice(0,10):
            String(row.date||'').slice(0,10);
          days.set(day,(days.get(day)||0)+1);
        }
      }
    });
    return {rows:[...days].map(([day,count])=>({day,count}))
      .sort((a,b)=>a.day.localeCompare(b.day))};
  }
  if(model.result==='daily-sources'){
    const grouped=new Map();
    await readAdaptiveSqlPages({
      countRows:async()=>Number((await q
        .select(eb=>eb.fn.countAll().as('row_count')).executeTakeFirst())?.row_count||0),
      fetchPage:({offset,limit})=>q.select(['date','site','createtime'])
        .orderBy('createtime','asc').limit(limit).offset(offset).execute(),
      consumePage:rows=>{
        for(const row of rows){
          const day=row.date instanceof Date?row.date.toISOString().slice(0,10):
            String(row.date||'').slice(0,10);
          const category=String(row.site||'').trim(),key=JSON.stringify([day,category]);
          grouped.set(key,(grouped.get(key)||0)+1);
        }
      }
    });
    const totals=new Map(),entries=[];
    for(const [key,item_count] of grouped){
      const [day,category]=JSON.parse(key);
      entries.push({day,kind:'source',category,item_count});
      totals.set(day,(totals.get(day)||0)+item_count);
    }
    entries.push(...[...totals].map(([day,item_count])=>({
      day,kind:'total',category:'文字作品',item_count
    })));
    entries.sort((a,b)=>a.day.localeCompare(b.day)||a.kind.localeCompare(b.kind)||
      a.category.localeCompare(b.category));
    return {rows:entries};
  }
  if(model.result==='sources'){
    const sources=new Map();
    await readAdaptiveSqlPages({
      countRows:async()=>Number((await q
        .select(eb=>eb.fn.countAll().as('row_count')).executeTakeFirst())?.row_count||0),
      fetchPage:({offset,limit})=>q.select(['site','createtime'])
        .orderBy('createtime','asc').limit(limit).offset(offset).execute(),
      consumePage:rows=>{
        for(const row of rows){
          const source=String(row.site??'');
          sources.set(source,(sources.get(source)||0)+1);
        }
      }
    });
    return {rows:[...sources].map(([source,count])=>({source,count}))
      .sort((a,b)=>a.source.localeCompare(b.source))};
  }
  if(model.result==='articles'){
    // Fixed GalaxyList and UID Anchor projection; article CONTENT is never
    // returned by list readers. Include a separate COUNT statement only when
    // explicitly requested by an existing Culture/Statistics list.
    const total=model.includeTotal
      ?Number((await q.select(eb=>eb.fn.countAll().as('count'))
        .executeTakeFirst())?.count||0):null;
    const limit=model.limit,offset=model.offset||0;
    let list=q.select(galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor'));
    if(model.feature!=='culture'||model.orderByDate===true)
      list=list.orderBy('date',model.sortDirection||'desc');
    const rows=await list.orderBy('createtime',model.sortDirection||'desc')
      .orderBy('uid','asc').limit(limit+1).offset(offset).execute();
    return {rows:rows.slice(0,limit),hasMore:rows.length>limit,
      nextCursor:rows.length>limit?{offset:offset+limit}:null,totalCount:total};
  }
  let query=q.select('uid').orderBy('uid','asc').limit(model.limit+1);
  if(model.cursor)query=query.where('uid','>',model.cursor);
  const rows=await query.execute(),uids=rows.slice(0,model.limit).map(row=>String(row.uid));
  return {uids,hasMore:rows.length>model.limit,
    nextCursor:rows.length>model.limit?uids.at(-1):null};
}
