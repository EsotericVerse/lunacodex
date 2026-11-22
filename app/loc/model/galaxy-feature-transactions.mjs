// Four fixed Galaxy feature models sharing the physical scoped Galaxy table.
// Browser callers can only select published feature, window, category and output.
import {z} from 'zod';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';

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
  throw Error('Missing physical Galaxy feature ZModel flag');

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const category=z.discriminatedUnion('type',[
  z.object({type:z.literal('source'),value:z.string().trim().min(1).max(120)}).strict(),
  z.object({type:z.literal('place'),value:z.string().regex(/^[A-Za-z0-9]{8}$/)}).strict(),
  // A keyword category is a LITERAL content search, not a classification
  // of Keyword Class/Item/Pattern Anchor records.
  z.object({type:z.literal('keyword'),value:z.string().trim().min(2).max(80)}).strict()
]);
const input=z.object({
  kind:z.literal('transaction'),operation:z.literal('galaxy-feature'),
  feature:z.enum(['culture','statics','search','trace']),
  scope:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  startDate:date,endDate:date,
  category:category.optional(),
  result:z.enum(['count','daily','sources','uids']),
  cursor:z.string().regex(/^[A-Za-z0-9]{8}$/).optional(),
  limit:z.number().int().min(1).max(100).optional()
}).strict();
function validDate(s){
  const parsed=new Date(s+'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===s;
}
export function parseGalaxyFeatureTransaction(raw){
  const parsed=input.safeParse(raw);
  if(!parsed.success)throw Object.assign(Error('Invalid Galaxy feature model'),{httpStatus:400});
  const value=parsed.data;
  if(!published.has(value.scope)||!validDate(value.startDate)||
    !validDate(value.endDate)||value.startDate>value.endDate||
    ((value.cursor!==undefined||value.limit!==undefined)&&value.result!=='uids'))
    throw Object.assign(Error('Invalid Galaxy feature model parameters'),{httpStatus:400});
  return {...value,limit:value.result==='uids'?(value.limit||100):undefined};
}
const PRIVATE_SITES=Object.freeze(['messenger','chatgpt','claude','gemini','msn',
  'whatsapp','telegram','discord','line','wechat','teams','copilot','grok',
  'perplexity','meta ai','meta-ai','mcp','github']);
function baseQuery(trx,model){
  let q=trx.selectFrom('silver.'+model.scope+'_galaxy')
    .where(GALAXY_FEATURE_MODELS[model.feature].flag,'=',true)
    .where('date','>=',model.startDate).where('date','<=',model.endDate)
    .where(eb=>eb.or([
      eb('site','is',null),
      eb(eb.fn('lower',['site']),'not in',PRIVATE_SITES)
    ]));
  const selector=model.category;
  if(selector?.type==='source')q=q.where('site','=',selector.value);
  if(selector?.type==='place')q=q.where('place_id','=',selector.value);
  if(selector?.type==='keyword'){
    // PostgreSQL ILIKE escapes wildcard characters with a backslash.
    // The parameter is bound by Kysely; it never supplies SQL syntax.
    const literal=selector.value.replace(/[\\%_]/g,character=>'\\'+character);
    if(model.feature!=='search')q=q.where('keyword','=',true);
    q=q.where('content','is not',null).where('content','ilike','%'+literal+'%');
  }
  // Listing is independently governed by Galaxy.list. Aggregates use
  // the requested feature flag, not the article-list visibility flag.
  if(model.result==='uids'){
    q=q.where('list','=',true);
    if(model.feature==='search')
      q=q.where('content','is not',null).where('content','!=','');
  }
  return q;
}
export async function executeGalaxyFeatureTransaction(trx,model){
  const q=baseQuery(trx,model);
  if(model.result==='count'){
    const row=await q.select(eb=>eb.fn.countAll().as('total')).executeTakeFirst();
    return {total:Number(row?.total||0)};
  }
  if(model.result==='daily'){
    const rows=await q.select('date').select(eb=>eb.fn.countAll().as('count'))
      .groupBy('date').orderBy('date','asc').execute();
    return {rows:rows.map(row=>({day:row.date instanceof Date
      ?row.date.toISOString().slice(0,10):String(row.date).slice(0,10),
      count:Number(row.count||0)}))};
  }
  if(model.result==='sources'){
    const rows=await q.select('site').select(eb=>eb.fn.countAll().as('count'))
      .groupBy('site').orderBy('site','asc').execute();
    return {rows:rows.map(row=>({source:row.site??'',count:Number(row.count||0)}))};
  }
  let query=q.select('uid').orderBy('uid','asc').limit(model.limit+1);
  if(model.cursor)query=query.where('uid','>',model.cursor);
  const rows=await query.execute();
  const uids=rows.slice(0,model.limit).map(row=>String(row.uid));
  return {uids,hasMore:rows.length>model.limit,
    nextCursor:rows.length>model.limit?uids.at(-1):null};
}
