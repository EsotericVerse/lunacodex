// A bounded LOC public SELECT contract on the existing Pages application.
// The browser never chooses a SQL engine, connection alias, schema or SQL text.
// Every query executes through the same server-owned Kysely Dialect as LOC Auth.
import {sql} from 'kysely';
import {executeKyselyAnalytics,executePortableKyselyAnalytics}
  from '../providers/kysely-analytics.mjs';
import {executeKyselyPublicAction} from '../providers/kysely-public.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {directMcpKysely} from '../mcp/native-kysely.mjs';
import {createScopedLocClient} from '../../../zenstack/client.mjs';
import {fixedPolicyReadModel,withFixedPolicyRead} from '../../../zenstack/policy-runtime.mjs';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {nativeReadPlan,executeNativeRead} from '../../../zenstack/native-query.mjs';
import {verifyModeledSqlFields,normalizeModeledTypeDifferences,
  normalizeModeledSelectRows} from '../../../zenstack/model-column-guard.mjs';
import {assertZModelSelectRows} from '../../../zenstack/import-validation.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {parsePortableOrExpression,portableContainsSpec}
  from '../providers/portable-search.mjs';
import {isTextSearchQuery,checkSearchQos} from '../providers/search-qos.mjs';
import {assertPublicKyselyReadShape,QUERY_FILTER_SQL}
  from '../../../zenstack/sql-input-shape.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const IDENT=/^[a-z_][a-z0-9_]*$/i;
const OPERATORS=new Set(Object.keys(QUERY_FILTER_SQL));
const SCOPE=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id));
const TABLE_RE=/^(?!loc_blocks$)([a-z][a-z0-9]{0,14})_(galaxy|anchor|blocks)$/;
const TABLES=new Set(['loc_anchor','runes','runes_etc','runes_group','lrunes_daily']);
// The public Daily Rune calendar, culture river, statistics and CSV export
// share one canonical read-only projection. No user/session/management fields,
// private record IDs, or unrestricted SQL columns are exposed by this route.
const DAILY_RUNE_PUBLIC_FIELDS=new Set([
  'record_date','draw_kind','rune_number','direction','recorded_phase'
]);
const DAILY_RUNE_FILTER_FIELDS=new Set(['record_date','draw_kind','rune_number']);
const DAILY_RUNE_ORDER_FIELDS=new Set(['record_date','draw_kind']);
const invalid=message=>Object.assign(new Error(message),{status:400});
function col(input){
  if(typeof input!=='string'||!IDENT.test(input))throw invalid('Invalid selected column');
  return input;
}
function publicRelation(schema,table){
  if(schema!=='silver'||typeof table!=='string')throw invalid('Invalid public relation');
  if(TABLES.has(table)||SCOPE.has(table))return table;
  const matched=TABLE_RE.exec(table);
  if(matched&&matched[1]!=='loc'&&SCOPE.has(matched[1]))return table;
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
  const operators=QUERY_FILTER_SQL;
  if(op==='ilike')
    return eb(sql`lower(${sql.ref(column)})`,'like',String(value).toLowerCase());
  if(op==='ieq')
    return eb(sql`lower(${sql.ref(column)})`,'=',String(value).toLowerCase());
  return eb(column,operators[op],value);
}
function normalize(body){
  // Reuse the same Zod 4 request-shape layer as the private Kysely gateway.
  // The public relation allowlist and field-level ZModel guard below remain
  // independent authorization boundaries, not part of syntax validation.
  try{assertPublicKyselyReadShape(body)}
  catch(error){throw invalid(error.message)}
  const table=publicRelation(body.schema,body.table);
  const columns=body.columns;
  const filters=body.filters||[],orFilters=body.orFilters||[],orders=body.orders||[];
  // An omitted LIMIT means a complete SELECT. Article lists explicitly request 100.
  const limit=body.limit==null?null:Number(body.limit);
  const offset=body.offset==null?0:Number(body.offset);
  if((limit!==null&&(!Number.isSafeInteger(limit)||limit<0))||
    !Number.isSafeInteger(offset)||offset<0)
    throw invalid('Invalid SQL page bounds');
  // Parse once at the request boundary, then reuse the identical typed AST
  // for both ZModel validation and the Kysely fallback SQL predicate.
  const parsedOrFilters=orFilters.map(parsePortableOrExpression);
  if(table==='lrunes_daily'&&(
    columns.some(name=>!DAILY_RUNE_PUBLIC_FIELDS.has(name))||
    filters.some(filter=>!DAILY_RUNE_FILTER_FIELDS.has(filter.column))||
    orders.some(order=>!DAILY_RUNE_ORDER_FIELDS.has(order.column))||
    parsedOrFilters.length>0
  ))throw invalid('Unavailable public Daily Rune field or filter');
  // No SQL connection is needed to reject unknown modeled columns, even
  // when they are nested in a grouped AND/OR expression.
  verifyModeledSqlFields({schema:'silver',table,columns,filters,
    orFilters:parsedOrFilters,orders});
  return {table,columns,filters,orFilters:parsedOrFilters,orders,limit,offset,
    head:body.head===true,cardinality:body.cardinality||null,count:body.count||null};
}


// Use the existing ZenStack ORM for ordinary model-compatible PostgreSQL/MySQL
// Scope reads, not only for exceptional Boolean conversions. Fixed Blocks use
// the PolicyPlugin-wrapped model; dynamic Scope IDs use the verified projection.
// The public Scope allowlist, exact query boundary and source visibility remain
// unchanged. Unsupported operators, arrays, raw expressions and other
// MSSQL and unsupported operators retain their existing Kysely executor. No
// new connection or polling.
function modeledPublicSelect(selected,query){
  if(!['postgres','mysql'].includes(selected.engine)||!selected.dialect||query.cardinality)
    return null;
  const fixedLocAnchor=query.table==='loc_anchor';
  const matched=/^(?!loc_blocks$)([a-z][a-z0-9]{0,14})_(galaxy|anchor|blocks)$/.exec(query.table);
  if(!fixedLocAnchor&&(!matched||!SCOPE.has(matched[1])))return null;
  const modelName=fixedLocAnchor?'LocAnchor':matched[2][0].toUpperCase()+matched[2].slice(1);
  const ordinaryFilters=query.filters.map(f=>({
    column:f.column,operator:f.op,value:f.value,negate:f.negate
  }));
  const typed=normalizeModeledTypeDifferences({
    schema:'silver',table:query.table,filters:ordinaryFilters
  });
  // ZModel already validates the requested columns and field-compatible
  // predicates. Prefer the native model when the lossless plan is supported,
  // whether or not Boolean adaptation happened to be necessary.
  const body={
    kind:'query',operation:'select',schema:'silver',table:query.table,
    columns:query.columns,filters:typed.filters,
    or:query.orFilters,
    orders:query.orders,limit:query.limit,offset:query.offset,
    head:query.head,count:query.head||query.count==='exact'
  };
  if(!nativeReadPlan(body,modelName))return null;
  const fixedSchema=selected.namespace||'silver';
  const fixedBody={kind:'query',operation:'select',schema:fixedSchema,table:query.table};
  const fixedModelName=fixedSchema==='silver'
    ?fixedPolicyReadModel(selected,fixedBody):null;
  if(fixedModelName)return {fixed:true,body,modelName:fixedModelName,
    policyBody:fixedBody};
  if(fixedLocAnchor)return null;
  return {client:createScopedLocClient({dialect:selected.dialect,
    engine:selected.engine,namespace:selected.namespace||'silver',scopeId:matched[1]}),body,modelName};
}

const PUBLIC_ACTIONS=new Set(['read_app_bootstrap','read_scope_page_copy',
  'block_list','hero_block','search_scope_trace_place_names']);
function normalizeAction(body){
  if(Object.keys(body).some(k=>!['kind','name','args'].includes(k))||
      !PUBLIC_ACTIONS.has(body.name)||!body.args||typeof body.args!=='object'||
      Array.isArray(body.args))
    throw invalid('Unavailable LOC public action');
  if(body.name==='hero_block'){
    // LOC Hero is selected by exact Anchor type, not by physical relation.
    const values=Array.isArray(body.args.p_type)?body.args.p_type:[body.args.p_type];
    if(Object.keys(body.args).some(k=>k!=='p_type')||
      values.length<1||values.length>2||new Set(values).size!==values.length||
      values.some(t=>typeof t!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(t)||
        ['from','domain','galaxy','universe','index','governance'].includes(t)))
      throw invalid('Invalid Hero type');
  }else if(!SCOPE.has(String(body.args.p_scope_id||''))||
    body.name==='block_list'&&Object.keys(body.args).some(k=>k!=='p_scope_id'))
    throw invalid('Unavailable LOC public action');
  if(body.name==='search_scope_trace_place_names'&&body.args.p_scope_id==='loc')
    throw invalid('Unavailable Trace Scope');
  return {name:body.name,args:body.args};
}

const PUBLIC_ANALYTICS=new Set(['culture_list','trace_places','trace_territory','trace_daily',
  'trace_keywords','lane_daily','shared_classes','search_summary','keyword_catalog','keyword_summary']);
const PUBLIC_ANALYTICS_OPTIONS=new Set(['scopeIds','placeIds','classUid','source','site','offset','media','platform','exact','withPoints']);
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
  if(options.withPoints!==undefined&&
      (mode!=='trace_territory'||typeof options.withPoints!=='boolean'))
    throw invalid('Invalid Trace territory Point join option');
  const ids=options.scopeIds;
  if(ids!==undefined&&(!Array.isArray(ids)||ids.length>100||
     ids.some(id=>!PUBLIC_SCOPES.includes(id))))
    throw invalid('Invalid published Scope list');
  const places=options.placeIds;
  if(places!==undefined&&(!Array.isArray(places)||places.length>80||
     places.some(id=>!/^[A-Za-z0-9]{8}$/.test(String(id)))))
    throw invalid('Invalid public Point IDs');
  if(options.media!==undefined&&typeof options.media!=='boolean')
    throw invalid('Invalid public lane media flag');
  for(const field of ['classUid','source','site','platform','exact']){
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
  const filters=normalizeModeledTypeDifferences({
    schema:'silver',table:body.table,filters:body.filters
  }).filters;
  for(const f of filters)
    q=q.where(eb=>f.negate===true?eb.not(predicate(eb,f)):predicate(eb,f));
  for(const source of body.orFilters){
    const ast=normalizeModeledTypeDifferences({
      schema:'silver',table:body.table,orFilters:[source]
    }).orFilters[0];
    q=q.where(eb=>predicate(eb,ast));
  }
  return q;
}
export async function handleNativePublicQuery(request,env={},{
  database=directMcpKysely
}={}){
  if(request.method!=='POST')return respond({error:'POST required'},405);
  let body,normalized,analytics=null,action=null;
  try{
    const raw=await request.text();
    if(raw.length>18000)throw invalid('Public query is too large');
    try{body=JSON.parse(raw)}catch{throw invalid('Invalid public JSON')}
    if(body?.kind==='analytics')analytics=normalizeAnalytics(body);
    else if(body?.kind==='public-action')action=normalizeAction(body);
    else normalized=normalize(body);
  }catch(error){return respond({error:String(error.message)},400)}
  // Search-only QoS: decide after validated model predicates, before opening
  // Kysely/ZenStack connections. UID, article lists and analytics bypass it.
  if(normalized&&isTextSearchQuery({
    kind:'query',operation:'select',table:normalized.table,
    filters:normalized.filters,orFilters:normalized.orFilters
  })){
    // Cloudflare supplies this header. Never trust browser-supplied IDs or
    // lump unknown visitors into one globally blocked anonymous identity.
    const source=request.headers.get('cf-connecting-ip');
    if(source){
      const decision=checkSearchQos(source);
      if(!decision.allowed)return new Response(JSON.stringify({
        error:'Search request rate limited',code:'SEARCH_RATE_LIMIT',stage:'search'
      }),{status:429,headers:{...HEADERS,
        'retry-after':String(Math.max(1,Math.ceil(decision.retryAfterMs/1000)))
      }});
    }
  }
  let stage='driver';
  try{
    // No bearer, email, user-supplied alias, SQL text or table override.
    // Force the same fixed control target used by api.manage authorization.
    const primary=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
    if(!primary)throw Error('LOC primary SQL target is not configured');
    const selected=await database(env,primary.target_id);
    if(!selected?.db||!['postgres','mysql','mssql'].includes(selected.engine))
      throw Error('LOC Kysely driver unavailable');
    const table=analytics||action?null:portableRelation(normalized.table,selected.engine,
      selected.namespace||(selected.engine==='postgres'?'silver':'dbo'));
    if(action){
      stage='public-action';
      const output=await executeKyselyPublicAction(selected.db,action,{
        engine:selected.engine,namespace:selected.namespace||
          (selected.engine==='postgres'?'silver':'dbo'),
        publishedScopeIds:[...SCOPE]
      });
      return respond({data:output.data,count:output.count??null});
    }
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
    const modeled=modeledPublicSelect(selected,normalized);
    if(modeled){
      const output=modeled.fixed
        ?await withFixedPolicyRead(selected.db,{engine:selected.engine},modeled.policyBody,
            'anon',{}, {dialect:selected.dialect,ZenStackClient,PolicyPlugin},
            (_qb,modelName,authorized)=>executeNativeRead(authorized,modeled.body,modelName))
        :await executeNativeRead(modeled.client,modeled.body,modeled.modelName);
      return respond({data:output.data,count:output.count??null});
    }
    if(normalized.head){
      const result=await withFilters(selected.db.selectFrom(table),normalized)
        .select(eb=>eb.fn.countAll().as('count')).executeTakeFirst();
      return respond({data:null,count:Number(result?.count||0)});
    }
    let query=withFilters(selected.db.selectFrom(table),normalized);
    query=normalized.columns[0]==='*'?query.selectAll():query.select(normalized.columns);
    for(const order of normalized.orders)
      query=query.orderBy(order.column,order.ascending===false?'desc':'asc');
    // Count=exact is the filtered relation count, NOT the current page size.
    // Preserve the existing query-builder contract across all SQL dialects.
    const fullCount=normalized.count==='exact'
      ?Number((await withFilters(selected.db.selectFrom(table),normalized)
        .select(eb=>eb.fn.countAll().as('count')).executeTakeFirst())?.count||0)
      :null;
    const rawRows=await (normalized.limit===null?query:query.limit(normalized.limit))
      .offset(normalized.offset).execute();
    const rows=normalizeModeledSelectRows({
      schema:'silver',table:normalized.table,rows:rawRows
    });
    assertZModelSelectRows('silver.'+normalized.table,normalized.columns,rows);
    if(normalized.cardinality==='single'&&rows.length!==1||
       normalized.cardinality==='maybeSingle'&&rows.length>1)
      return respond({error:'Expected one LOC record',stage:'cardinality'},406);
    return respond({data:normalized.cardinality?rows[0]||null:rows,
      count:fullCount});
  }catch(error){
    // Public diagnostics expose only fixed transport categories, never
    // connection hosts, credentials, SQL statements, or query parameters.
    let code='UNKNOWN',cause=error;
    const descriptions=[],types=[];
    for(let depth=0;cause&&depth<5;depth++,cause=cause.cause){
      if(/^[A-Za-z0-9_]{2,40}$/.test(String(cause.code||''))&&code==='UNKNOWN')
        code=String(cause.code);
      descriptions.push(String(cause.message||'').toLowerCase());
      types.push(String(cause.name||''));
    }
    const message=descriptions.join(' ');
    const reason=
      /certificate|self.signed|tls|ssl|secure connection|handshake/.test(message)?'TLS':
      /password authentication|scram|sasl|authentication failed/.test(message)?'DB_AUTH':
      /permission denied|insufficient privilege/.test(message)?'DB_PRIVILEGE':
      /relation .* does not exist|undefined table/.test(message)?'DB_RELATION':
      /getaddrinfo|dns|name resolution|enotfound|eai_again/.test(message)?'DNS':
      /network|socket|connect|connection|timeout|timed out|unreachable|refused/.test(message)?'TRANSPORT':
      /unsupported|not implemented|not supported/.test(message)?'RUNTIME_UNSUPPORTED':
      /cannot read|is not a function|undefined|typeerror/.test(message)?'RUNTIME_TYPE':
      /pool|client/.test(message)?'DRIVER_POOL':'UNCLASSIFIED';
    const type=types.find(name=>['Error','TypeError','SyntaxError','RangeError','AggregateError'].includes(name))||'Other';
    console.error('[LOC public Kysely]',{stage,code,reason,type});
    return respond({error:'LOC Kysely public read failed',stage,code,reason,type},503);
  }
}
