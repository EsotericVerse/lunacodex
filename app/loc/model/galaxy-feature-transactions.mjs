// Four fixed Galaxy feature models. Query structure and physical relation are
// selected only by this server module, never by a browser SQL expression.
import {z} from 'zod';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {galaxyReadColumns,galaxyReadColumnsFor}
  from '../../../packages/zenstack/galaxy-read-models.mjs';
import {parseSearchQuery} from '../search/query.mjs';

export const GALAXY_FEATURE_MODELS=Object.freeze({
  culture:Object.freeze({flag:'culture',name:'GalaxyCulture'}),
  statics:Object.freeze({flag:'statics',name:'GalaxyStatistics'}),
  search:Object.freeze({flag:'search',name:'GalaxySearch'}),
  trace:Object.freeze({flag:'trace',name:'GalaxyTrace'})
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
  kind:z.literal('transaction'),operation:z.literal('galaxy-feature'),
  feature:z.enum(['culture','statics','search','trace']),
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
  includeTotal:z.boolean().optional(),
  limit:z.number().int().min(1).max(100).optional()
}).strict();
function validDate(s){
  const v=new Date(s+'T00:00:00Z');
  return !Number.isNaN(v.getTime())&&v.toISOString().slice(0,10)===s;
}
export function parseGalaxyFeatureTransaction(raw){
  const parsed=input.safeParse(raw);
  if(!parsed.success)throw Object.assign(Error('Invalid Galaxy feature model'),{httpStatus:400});
  const value=parsed.data;
  if(!published.has(value.scope)||
    value.startDate!==undefined&&!validDate(value.startDate)||
    value.endDate!==undefined&&!validDate(value.endDate)||
    value.startDate&&value.endDate&&value.startDate>value.endDate||
    (value.cursor!==undefined&&value.result!=='uids')||
    (value.offset!==undefined&&value.result!=='articles')||
    (value.sortDirection!==undefined&&value.result!=='articles')||
    (value.includeTotal!==undefined&&value.result!=='articles')||
    (value.limit!==undefined&&!['uids','articles'].includes(value.result))||
    (value.text||value.requiredTerms||value.excludedTerms)&&value.feature!=='search'||
    value.placeIds&&value.category?.type==='place'||
    value.mediaUrls&&value.feature!=='trace')
    throw Object.assign(Error('Invalid Galaxy feature parameters'),{httpStatus:400});
  return {...value,limit:['uids','articles'].includes(value.result)?value.limit||100:undefined};
}
const PRIVATE_SITES=Object.freeze(['messenger','chatgpt','claude','gemini',
  'msn','whatsapp','telegram','discord','line','wechat','teams','copilot',
  'grok','perplexity','meta ai','meta-ai','mcp','github']);
// Text terms are SQL *values* only. Escape LIKE wildcard syntax so the
// search grammar cannot accidentally become a pattern-language SQL API.
const pattern=value=>'%'+String(value).replace(/[\\%_]/g,x=>'\\'+x)+'%';
function baseQuery(trx,model){
  let q=trx.selectFrom('silver.'+model.scope+'_galaxy')
    .where(GALAXY_FEATURE_MODELS[model.feature].flag,'=',true)
    .where(eb=>eb.or([eb('site','is',null),
      eb(eb.fn('lower',['site']),'not in',PRIVATE_SITES)]));
  if(model.startDate)q=q.where('date','>=',model.startDate);
  if(model.endDate)q=q.where('date','<=',model.endDate);
  const selector=model.category;
  if(selector?.type==='source')q=q.where('site','=',selector.value);
  if(selector?.type==='place')q=q.where('place_id','=',selector.value);
  if(model.sources)q=q.where(eb.fn('lower',['site']),'in',
    model.sources.map(name=>name.toLowerCase()));
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
  if(model.text){
    const parsed=parseSearchQuery(model.text);
    if(!parsed.groups.length&&parsed.excludes.length===0)
      throw Object.assign(Error('Empty Search terms'),{httpStatus:400});
    if(parsed.groups.length>6||parsed.groups.some(group=>group.length>8)||
      parsed.excludes.length>8)
      throw Object.assign(Error('Search term budget exceeded'),{httpStatus:400});
    q=q.where('content','is not',null).where('content','!=','');
    if(parsed.groups.length)
      q=q.where(eb=>eb.or(parsed.groups.map(group=>eb.and(
        group.map(term=>eb('content','ilike',pattern(term)))))));
    for(const term of parsed.excludes)
      q=q.where('content','not ilike',pattern(term));
  }
  for(const term of model.requiredTerms||[])
    q=q.where('content','ilike',pattern(term));
  for(const term of model.excludedTerms||[])
    q=q.where('content','not ilike',pattern(term));
  if(['uids','articles'].includes(model.result)){
    q=q.where('list','=',true);
    if(model.feature==='search')q=q.where('content','is not',null)
      .where('content','!=','');
  }
  return q;
}
export async function executeGalaxyFeatureTransaction(trx,model){
  const q=baseQuery(trx,model);
  if(model.result==='earliest'){
    const row=await q.select(eb=>eb.fn.min('date').as('earliest')).executeTakeFirst();
    return {earliest:row?.earliest||null};
  }
  if(model.result==='count'){
    const row=await q.select(eb=>eb.fn.countAll().as('total')).executeTakeFirst();
    return {total:Number(row?.total||0)};
  }
  if(model.result==='daily'){
    const rows=await q.select('date').select(eb=>eb.fn.countAll().as('count'))
      .groupBy('date').orderBy('date','asc').execute();
    return {rows:rows.map(row=>({day:row.date instanceof Date
      ?row.date.toISOString().slice(0,10):String(row.date||'').slice(0,10),
      count:Number(row.count||0)}))};
  }
  if(model.result==='daily-sources'){
    const rows=await q.select(['date','site'])
      .select(eb=>eb.fn.countAll().as('count'))
      .groupBy(['date','site']).orderBy('date','asc').orderBy('site','asc')
      .execute();
    const totals=new Map(),entries=[];
    for(const row of rows){
      const day=row.date instanceof Date?row.date.toISOString().slice(0,10):
        String(row.date||'').slice(0,10);
      const category=String(row.site||'').trim(),item_count=Number(row.count||0);
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
    const rows=await q.select('site').select(eb=>eb.fn.countAll().as('count'))
      .groupBy('site').orderBy('site','asc').execute();
    return {rows:rows.map(row=>({source:row.site??'',count:Number(row.count||0)}))};
  }
  if(model.result==='articles'){
    // Fixed GalaxyList and UID Anchor projection; article CONTENT is never
    // returned by list readers. Include COUNT in the same transaction only
    // when explicitly requested by an existing Culture/Statistics list.
    const total=model.includeTotal
      ?Number((await q.select(eb=>eb.fn.countAll().as('count'))
        .executeTakeFirst())?.count||0):null;
    const limit=model.limit,offset=model.offset||0;
    let list=q.select(galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor'));
    if(model.feature!=='culture')list=list.orderBy('date',model.sortDirection||'desc');
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
