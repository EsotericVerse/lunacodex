// A bounded LOC public SELECT contract on the existing Pages application.
// The browser never chooses a SQL engine, connection alias, schema or SQL text.
// Every query executes through the same server-owned Kysely Dialect as LOC Auth.
import {sql} from 'kysely';
import {executeKyselyAnalytics,executePortableKyselyAnalytics}
  from '../providers/kysely-analytics.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {directMcpKysely} from '../mcp/native-kysely.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {parsePortableOrExpression,portableContainsSpec}
  from '../providers/portable-search.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const IDENT=/^[a-z_][a-z0-9_]*$/i;
const OPERATORS=new Set(['eq','neq','gt','gte','lt','lte','like','ilike','is','in','contains']);
const SCOPE=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id));
const TABLE_RE=/^([a-z][a-z0-9]{0,14})_(galaxy|galaxy_media|anchor|blocks|keywords|trace|time)$/;
const TABLES=new Set(['loc_blocks','runes','runes_etc','runes_group']);
const invalid=message=>Object.assign(new Error(message),{status:400});
function col(input){
  if(typeof input!=='string'||!IDENT.test(input))throw invalid('Invalid selected column');
  return input;
}
function publicRelation(schema,table){
  if(schema!=='silver'||typeof table!=='string')throw invalid('Invalid public relation');
  if(TABLES.has(table)||SCOPE.has(table))return table;
  const matched=TABLE_RE.exec(table);
  if(matched&&SCOPE.has(matched[1]))return table;
  throw invalid('Public relation unavailable');
}
function predicate(eb,node){
  if(node?.type==='and'||node?.type==='or'){
    if(!Array.isArray(node.items)||node.items.length<1||node.items.length>30)
      throw invalid('Invalid grouped filter');
    const children=node.items.map(item=>predicate(eb,item));
    return node.type==='and'?eb.and(children):eb.or(children);
  }
  const column=col(node?.column),op=String(node?.op||node?.operator||'');
  if(!OPERATORS.has(op))throw invalid('Invalid SQL filter operator');
  const value=node.value;
  if(op==='in'){
    if(!Array.isArray(value)||value.length>200)throw invalid('Invalid IN filter');
    return eb(column,'in',value);
  }
  if(op==='contains'){
    const spec=portableContainsSpec(value);
    return eb(spec.fold?sql`lower(${sql.ref(column)})`:sql.ref(column),'like',spec.pattern);
  }
  if(op==='is'){
    if(value!==null&&typeof value!=='boolean')throw invalid('Invalid IS operand');
    return eb(column,'is',value);
  }
  if(value===null)return eb(column,op==='neq'?'is not':'is',null);
  const operators={eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
    like:'like',ilike:'ilike'};
  if(op==='ilike')
    return eb(sql`lower(${sql.ref(column)})`,'like',String(value).toLowerCase());
  return eb(column,operators[op],value);
}
function normalize(body){
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw invalid('Invalid LOC public query');
  const keys=Object.keys(body),expected=new Set([
    'schema','table','columns','filters','orFilters','orders','limit','offset',
    'head','count','cardinality']);
  if(keys.some(key=>!expected.has(key)))throw invalid('Unexpected SQL query field');
  const table=publicRelation(body.schema,body.table);
  const columns=body.columns;
  if(!Array.isArray(columns)||!columns.length||columns.length>48||
    columns.some(x=>x!=='*'&&!IDENT.test(String(x)))||
    columns.includes('*')&&columns.length!==1)
    throw invalid('Invalid public SQL projection');
  const filters=body.filters||[],orFilters=body.orFilters||[],orders=body.orders||[];
  if(!Array.isArray(filters)||filters.length>30||
    !Array.isArray(orFilters)||orFilters.length>10||
    !Array.isArray(orders)||orders.length>10)
    throw invalid('Public query exceeds allowed filters');
  for(const f of filters){
    if(!f||typeof f!=='object'||Array.isArray(f))throw invalid('Invalid filter');
    col(f.column);
    if(!OPERATORS.has(f.op))throw invalid('Invalid filter operator');
  }
  for(const value of orFilters)
    if(typeof value!=='string'||value.length>4000)throw invalid('Invalid grouped query');
  for(const order of orders){
    if(!order||typeof order!=='object'||Array.isArray(order))throw invalid('Invalid order');
    col(order.column);
  }
  const limit=Number(body.limit),offset=Number(body.offset);
  if(!Number.isSafeInteger(limit)||limit<0||limit>5000||
    !Number.isSafeInteger(offset)||offset<0||offset>10000000)
    throw invalid('Invalid SQL page bounds');
  if(body.cardinality!=null&&!['single','maybeSingle'].includes(body.cardinality))
    throw invalid('Invalid SQL result cardinality');
  if(body.count!=null&&body.count!=='exact')
    throw invalid('Invalid SQL count mode');
  if(body.head!=null&&typeof body.head!=='boolean')throw invalid('Invalid SQL HEAD');
  return {table,columns,filters,orFilters,orders,limit,offset,
    head:body.head===true,cardinality:body.cardinality||null,count:body.count||null};
}

const PUBLIC_ANALYTICS=new Set(['culture_list','trace_places','trace_daily',
  'trace_keywords','shared_classes','search_summary','keyword_catalog','keyword_summary']);
const PUBLIC_ANALYTICS_OPTIONS=new Set(['scopeIds','placeIds','classUid','source','site','offset']);
const PUBLIC_SCOPES=[...SCOPE].filter(id=>id!=='loc');
function normalizeAnalytics(body){
  if(Object.keys(body).some(key=>!['kind','args'].includes(key))||
      body.kind!=='analytics'||!body.args||typeof body.args!=='object'||
      Array.isArray(body.args))throw invalid('Invalid analytics request');
  const args=body.args;
  if(Object.keys(args).some(key=>!['p_scope_id','p_view','p_start','p_end','p_options'].includes(key)))
    throw invalid('Invalid analytics parameters');
  const mode=String(args.p_view||''),scope=String(args.p_scope_id||'');
  if(!PUBLIC_ANALYTICS.has(mode)||!SCOPE.has(scope)||
      (mode==='search_summary')!==(scope==='loc'))
    throw invalid('Unavailable public analytics view');
  const options=args.p_options??{};
  if(!options||typeof options!=='object'||Array.isArray(options)||
     Object.keys(options).some(key=>!PUBLIC_ANALYTICS_OPTIONS.has(key)))
    throw invalid('Invalid public analytics options');
  const ids=options.scopeIds;
  if(ids!==undefined&&(!Array.isArray(ids)||ids.length>100||
     ids.some(id=>!PUBLIC_SCOPES.includes(id))))
    throw invalid('Invalid published Scope list');
  const places=options.placeIds;
  if(places!==undefined&&(!Array.isArray(places)||places.length>80||
     places.some(id=>!/^[A-Za-z0-9]{8}$/.test(String(id)))))
    throw invalid('Invalid public Point IDs');
  for(const field of ['classUid','source','site']){
    if(options[field]!==undefined&&options[field]!==null&&
       (typeof options[field]!=='string'||options[field].length>120))
      throw invalid('Invalid public analytics selector');
  }
  if(options.offset!==undefined&&(!Number.isSafeInteger(options.offset)||
      options.offset<0||options.offset>100000))throw invalid('Invalid public list offset');
  for(const name of ['p_start','p_end']){
    if(args[name]!=null&&args[name]!==''&&
       (typeof args[name]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(args[name])))
      throw invalid('Invalid public analytics date');
  }
  return args;
}

function withFilters(q,body){
  for(const f of body.filters)
    q=q.where(eb=>f.negate===true?eb.not(predicate(eb,f)):predicate(eb,f));
  for(const source of body.orFilters){
    const ast=parsePortableOrExpression(source);
    q=q.where(eb=>predicate(eb,ast));
  }
  return q;
}
export async function handleNativePublicQuery(request,env={},{
  database=directMcpKysely
}={}){
  if(request.method!=='POST')return respond({error:'POST required'},405);
  let body,normalized,analytics=null;
  try{
    const raw=await request.text();
    if(raw.length>18000)throw invalid('Public query is too large');
    try{body=JSON.parse(raw)}catch{throw invalid('Invalid public JSON')}
    if(body?.kind==='analytics')analytics=normalizeAnalytics(body);
    else normalized=normalize(body);
  }catch(error){return respond({error:String(error.message)},400)}
  let stage='driver';
  try{
    // No bearer, email, user-supplied alias, SQL text or table override.
    // Force the same fixed control target used by api.manage authorization.
    const primary=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
    if(!primary)throw Error('LOC primary SQL target is not configured');
    const selected=await database(env,primary.target_id);
    if(!selected?.db||!['postgres','mysql','mssql'].includes(selected.engine))
      throw Error('LOC Kysely driver unavailable');
    const table=analytics?null:portableRelation(normalized.table,selected.engine,
      selected.namespace||(selected.engine==='postgres'?'silver':'dbo'));
    if(analytics){
      stage='analytics';
      const settings={role:'anon',publishedScopeIds:PUBLIC_SCOPES};
      const output=selected.engine==='postgres'
        ?await executeKyselyAnalytics(selected.db,analytics,settings)
        :await executePortableKyselyAnalytics(selected.db,analytics,{
          engine:selected.engine,namespace:selected.namespace||'dbo',role:'anon'
        });
      return respond({data:output.data,count:output.count??null});
    }
    stage='select';
    if(normalized.head){
      const result=await withFilters(selected.db.selectFrom(table),normalized)
        .select(eb=>eb.fn.countAll().as('count')).executeTakeFirst();
      return respond({data:null,count:Number(result?.count||0)});
    }
    let query=withFilters(selected.db.selectFrom(table),normalized);
    query=normalized.columns[0]==='*'?query.selectAll():query.select(normalized.columns);
    for(const order of normalized.orders)
      query=query.orderBy(order.column,order.ascending===false?'desc':'asc');
    const rows=await query.limit(normalized.limit).offset(normalized.offset).execute();
    if(normalized.cardinality==='single'&&rows.length!==1||
       normalized.cardinality==='maybeSingle'&&rows.length>1)
      return respond({error:'Expected one LOC record',stage:'cardinality'},406);
    return respond({data:normalized.cardinality?rows[0]||null:rows,
      count:normalized.count?rows.length:null});
  }catch(error){
    let code='UNKNOWN',cause=error;
    for(let depth=0;cause&&depth<5;depth++,cause=cause.cause)
      if(/^[A-Za-z0-9_]{2,40}$/.test(String(cause.code||''))){
        code=String(cause.code);break;
      }
    console.error('[LOC public Kysely]',{stage,code});
    return respond({error:'LOC Kysely public read failed',stage,code},503);
  }
}
