// Only fixed feature operations may cross this public entry. The existing
// legacy generic SELECT executor is NOT directly exposed as an HTTP route.
import {executeKyselyAnalytics,executePortableKyselyAnalytics} from '../providers/kysely-analytics.mjs';
import {executeKyselyPublicAction} from '../providers/kysely-public.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {assertZModelAnchorFeatureRows} from '../../../packages/zenstack/import-validation.mjs';
import {publishedLocAccess} from '../permissions/loc-business-grants.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../mcp/native-kysely.mjs';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction,GALAXY_FEATURE_MODELS} from '../model/galaxy-feature-transactions.mjs';
import {checkSearchQos} from '../providers/search-qos.mjs';
import {parseGalaxyRecordTransaction,executeGalaxyRecordTransaction} from '../model/galaxy-record-transactions.mjs';
import {parseAnchorFeatureTransaction,executeAnchorFeatureTransaction} from '../model/anchor-feature-transactions.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id));
const UID=/^[A-Za-z0-9]{8}$/;
const ACTIONS=new Set(['block_list','hero_block','read_scope_page_copy',
  'search_scope_trace_place_names']);
const ANALYTICS=new Set(['culture_list','trace_places','trace_territory',
  'trace_daily','trace_keywords','lane_daily','shared_classes','search_summary',
  'keyword_catalog','keyword_summary']);
const ANALYTICS_OPTIONS=new Set(['scopeIds','placeIds','classUid','source','site',
  'offset','platform','exact','withPoints','statisticsOnly']);
const ACTION_ARGS=Object.freeze({
  block_list:['p_scope_id'],hero_block:['p_type'],
  read_scope_page_copy:['p_scope_id'],
  search_scope_trace_place_names:['p_scope_id','p_term','p_limit']
});
const OBJECT=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const KEYS=(value,allowed)=>OBJECT(value)&&Object.keys(value).every(key=>allowed.includes(key));
const bad=()=>Object.assign(new Error('Invalid named LOC transaction'),{httpStatus:400});
function sameOrigin(request){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)
    throw Object.assign(new Error('Cross-origin request denied'),{httpStatus:403});
}
function scopeId(value){
  const id=String(value||'');
  if(!/^[a-z][a-z0-9]{0,14}$/.test(id)||id==='loc'||!published.has(id))
    throw bad();
  return id;
}
function normalize(body){
  if(!KEYS(body,['kind','operation','scope','mode','cursor','limit','args','name',
    'feature','startDate','endDate','category','result',
    'view','uids','family','types','order',
    'sources','excludedSources','placeIds','text','requiredTerms',
    'excludedTerms','mediaUrls','offset','sortDirection','includeTotal',
    'startDate','endDate','orderByDate'])||
    body.kind!=='transaction')throw bad();
  if(body.operation==='time-anchors'){
    if(!KEYS(body,['kind','operation','scope','mode','cursor','limit']))throw bad();
    const scope=scopeId(body.scope);
    const mode=body.mode||'public',cursor=body.cursor||'',limit=body.limit??2000;
    if(!['public','editor'].includes(mode)||typeof cursor!=='string'||
      (cursor&&!UID.test(cursor))||!Number.isSafeInteger(limit)||limit<1||limit>2000)
      throw bad();
    return {operation:'time-anchors',scope,mode,cursor,limit};
  }
  if(body.operation==='galaxy-feature')return parseGalaxyFeatureTransaction(body);
  if(body.operation==='galaxy-records')return parseGalaxyRecordTransaction(body);
  if(body.operation==='anchor-feature')return parseAnchorFeatureTransaction(body);
  if(body.operation==='analytics'){
    if(!KEYS(body,['kind','operation','args'])||!OBJECT(body.args))throw bad();
    const args=body.args,view=String(args.p_view||'');
    const scope=String(args.p_scope_id||'');
    const options=args.p_options??{};
    if(!KEYS(args,['p_scope_id','p_view','p_start','p_end','p_options'])||
      !ANALYTICS.has(view)||!published.has(scope)||
      (view==='search_summary')!==(scope==='loc')||
      !KEYS(options,[...ANALYTICS_OPTIONS]))throw bad();
    if(options.scopeIds!==undefined&&(!Array.isArray(options.scopeIds)||
      options.scopeIds.length>100||
      options.scopeIds.some(id=>id==='loc'||!published.has(id))))throw bad();
    if(options.placeIds!==undefined&&(!Array.isArray(options.placeIds)||
      options.placeIds.length>80||
      options.placeIds.some(uid=>!UID.test(String(uid||'')))))throw bad();
    if(options.withPoints!==undefined&&
      (view!=='trace_territory'||typeof options.withPoints!=='boolean'))throw bad();
    // Trace and Statistics remain independent Galaxy switches. Only the
    // Statistics place/territory projections may require both at once.
    if(options.statisticsOnly!==undefined&&
      (!['trace_places','trace_territory'].includes(view)||
       typeof options.statisticsOnly!=='boolean'))throw bad();
    if(options.offset!==undefined&&(!Number.isSafeInteger(options.offset)||
      options.offset<0||options.offset>100000))throw bad();
    for(const name of ['classUid','source','site','platform','exact'])
      if(options[name]!==undefined&&options[name]!==null&&
        (typeof options[name]!=='string'||options[name].length>120))throw bad();
    for(const name of ['p_start','p_end']){
      const day=args[name];
      if(day!=null&&day!==''&&(typeof day!=='string'||
        !/^\d{4}-\d{2}-\d{2}$/.test(day)))throw bad();
    }
    return {operation:'analytics',args};
  }
  if(body.operation==='action'){
    if(!KEYS(body,['kind','operation','name','args'])||
      !ACTIONS.has(body.name)||!OBJECT(body.args)|| 
      !KEYS(body.args,ACTION_ARGS[body.name]))throw bad();
    if(body.name==='hero_block'){
      const names=Array.isArray(body.args.p_type)?body.args.p_type:[body.args.p_type];
      if(names.length<1||names.length>2||new Set(names).size!==names.length||
        names.some(name=>typeof name!=='string'||
          !/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(name)||
          ['from','domain','galaxy','universe','index','governance'].includes(name)))throw bad();
    }else if(!published.has(String(body.args.p_scope_id||'')))throw bad();
    return {operation:'action',name:body.name,args:body.args};
  }
  throw bad();
}
function canEdit(session,scope){
  const grants=publishedLocAccess(session.email,{website:true}).grants;
  return grants.includes('global:manage')||grants.includes(scope+':write');
}

export async function handleNamedPublicTransaction(request,env={},{
  database=directMcpKysely,waitUntil,verifySession=verifiedLocWebsiteSession
}={}){
  if(request.method!=='POST')return respond({error:'POST required'},405);
  let operation;
  try{
    sameOrigin(request);
    const raw=await request.text();
    if(raw.length>12000)throw bad();
    operation=normalize(JSON.parse(raw));
  }catch(error){return respond({error:'Invalid named LOC transaction'},error.httpStatus||400)}
  // Only TimeAnchor editing and editor-only Point-name suggestions require a
  // Session. Identity is verified once; grants are calculated from JS, not SQL.
  if(['galaxy-records','anchor-feature'].includes(operation.operation)&&
     operation.mode==='editor'||
     (operation.operation==='time-anchors'&&operation.mode==='editor'||
     operation.operation==='action'&&operation.name==='search_scope_trace_place_names')){
    let session;
    try{session=await verifySession(request)}
    catch(error){return respond({error:'LOC Session unavailable'},error.httpStatus||503)}
    let scope;
    try{scope=['time-anchors','galaxy-records','anchor-feature'].includes(operation.operation)
      ?operation.scope:scopeId(operation.args.p_scope_id)}
    catch{return respond({error:'Unavailable Scope'},400)}
    if(!canEdit(session,scope))return respond({error:'LOC Scope not authorized'},403);
  }
  if(operation.operation==='galaxy-records'||operation.operation==='anchor-feature'){
    let port=null,release=()=>{},status=200;
    const initiated=Date.now();
    const receipt={requestedBy:operation.operation==='galaxy-records'?'galaxy':'anchor',
      model:operation.operation,scope:operation.scope,
      view:operation.view||operation.family,mode:operation.mode,
      ray:String(request.headers.get('cf-ray')||'').slice(0,80)||null};
    try{
      const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
      if(!primary)throw Error('LOC database unavailable');
      port=await database(env,primary.target_id,{waitUntil});
      release=bindLocRequestAbort(port,request.signal);
      if(!port?.db||port.engine!=='postgres')throw Error('LOC database unavailable');
      const data=await port.db.transaction().setIsolationLevel('repeatable read')
        .execute(trx=>operation.operation==='galaxy-records'
          ?executeGalaxyRecordTransaction(trx,operation)
          :executeAnchorFeatureTransaction(trx,operation));
      return respond({data,transaction:receipt});
    }catch(error){
      status=error?.httpStatus||503;
      console.error('[LOC fixed record transaction failed]',{...receipt,
        code:String(error?.code||'FAILED').slice(0,40)});
      return respond({error:'Fixed record transaction unavailable',
        transaction:receipt},status);
    }finally{
      console.info('[LOC fixed record transaction]',{
        ...receipt,status,elapsedMs:Date.now()-initiated});
      release();
      try{await closeLocDatabase(port)}catch{}
    }
  }
  if(operation.operation==='galaxy-feature'){
    // Parse and validate the fixed model before any SQL connection.
    if(operation.category?.type==='keyword'){
      const ip=request.headers.get('cf-connecting-ip');
      if(ip){
        const check=checkSearchQos(ip);
        if(!check.allowed)return new Response(JSON.stringify({
          error:'Galaxy keyword request rate limited',code:'SEARCH_RATE_LIMIT'
        }),{status:429,headers:{...HEADERS,
          'retry-after':String(Math.max(1,Math.ceil(check.retryAfterMs/1000)))}});
      }
    }
    let port=null,unbind=()=>{};
    const started=Date.now();
    const ray=String(request.headers.get('cf-ray')||'').slice(0,80);
    // Referrer is best-effort navigation diagnostics, never an authorization
    // claim. Only a same-origin path is retained; no cookies or query string.
    let requestPath=null;
    try{
      const ref=request.headers.get('referer');
      const page=ref?new URL(ref):null;
      if(page&&page.origin===new URL(request.url).origin)
        requestPath=page.pathname.slice(0,160);
    }catch{}
    const modelName=GALAXY_FEATURE_MODELS[operation.feature].name;
    const receipt={requestedBy:operation.feature,model:modelName,
      scope:operation.scope,result:operation.result,ray:ray||null,
      requestPath};
    let status=200;
    try{
      const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
      if(!primary)throw Error('LOC database unavailable');
      port=await database(env,primary.target_id,{waitUntil});
      unbind=bindLocRequestAbort(port,request.signal);
      if(!port?.db||port.engine!=='postgres')throw Error('LOC PostgreSQL unavailable');
      const data=await port.db.transaction().setIsolationLevel('repeatable read')
        .execute(trx=>executeGalaxyFeatureTransaction(trx,operation));
      return respond({data,transaction:receipt});
    }catch(error){
      status=503;
      console.error('[LOC Galaxy feature failed]',{...receipt,
        code:String(error?.code||'FAILED').slice(0,40)});
      return respond({error:'LOC Galaxy feature transaction unavailable',
        transaction:receipt},status);
    }finally{
      console.info('[LOC Galaxy feature transaction]',{
        ...receipt,status,elapsedMs:Date.now()-started});
      unbind();
      try{await closeLocDatabase(port)}
      catch{console.error('[LOC Galaxy feature] connection cleanup failed')}
    }
  }
  if(operation.operation==='analytics'||operation.operation==='action'){
    // Execute only hardcoded feature models in this request's own DB
    // transaction. Never bridge to the removed arbitrary SELECT executor.
    let port=null,unbind=()=>{};
    try{
      const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
      if(!primary)throw Error('LOC database unavailable');
      port=await database(env,primary.target_id,{waitUntil});
      unbind=bindLocRequestAbort(port,request.signal);
      if(!port?.db||!['postgres','mysql','mssql'].includes(port.engine))
        throw Error('LOC database unavailable');
      const namespace=port.namespace||(port.engine==='postgres'?'silver':'dbo');
      const ids=[...published];
      // A single snapshot for ALL dialects. Portable views such as
      // search_summary and loc iterate across Scopes: without a transaction
      // those SELECTs could observe different concurrent commits.
      const output=await port.db.transaction().setIsolationLevel('repeatable read')
        .execute(trx=>port.engine==='postgres'
          ?operation.operation==='analytics'
            ?executeKyselyAnalytics(trx,{args:operation.args},{
              role:'anon',publishedScopeIds:ids.filter(id=>id!=='loc')})
            :executeKyselyPublicAction(trx,{name:operation.name,args:operation.args},{
              engine:port.engine,namespace,publishedScopeIds:ids})
          :operation.operation==='analytics'
            ?executePortableKyselyAnalytics(trx,{args:operation.args},{
              engine:port.engine,namespace,role:'anon'})
            :executeKyselyPublicAction(trx,{name:operation.name,args:operation.args},{
              engine:port.engine,namespace,publishedScopeIds:ids}));
      return respond({data:output.data,count:output.count??null});
    }catch(error){
      console.error('[LOC named feature transaction]',{
        feature:operation.operation,code:String(error?.code||'FAILED').slice(0,40)});
      return respond({error:'Named LOC feature transaction unavailable'},
        error.httpStatus||503);
    }finally{
      unbind();
      try{await closeLocDatabase(port)}
      catch{console.error('[LOC named feature] connection cleanup failed')}
    }
  }
  let port=null,unbind=()=>{};
  try{
    const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
    if(!primary)throw Error('LOC database unavailable');
    port=await database(env,primary.target_id,{waitUntil});
    unbind=bindLocRequestAbort(port,request.signal);
    if(!port?.db||port.engine!=='postgres')throw Error('LOC PostgreSQL unavailable');
    const result=await port.db.transaction().setIsolationLevel('repeatable read')
      .execute(async trx=>{
        // Physical table name is derived exclusively from published JS Scope.
        const table=portableRelation(operation.scope+'_anchor',port.engine,
          port.namespace||'silver');
        let query=trx.selectFrom(table)
          .select(['uid','type','title','description','attr','invisible'])
          .where('type','in',ANCHOR_TYPE_GROUPS.time)
          .orderBy('uid','asc').limit(operation.limit+1);
        if(operation.mode==='public')query=query.where('invisible','=',false);
        if(operation.cursor)query=query.where('uid','>',operation.cursor);
        const rows=await query.execute();
        const page=assertZModelAnchorFeatureRows(rows.slice(0,operation.limit));
        return {data:page,nextCursor:rows.length>operation.limit
          ?String(page.at(-1).uid):null};
      });
    return respond(result);
  }catch(error){
    console.error('[LOC named TimeAnchor transaction]',{
      code:String(error?.code||'FAILED').slice(0,40)});
    return respond({error:'LOC TimeAnchor transaction unavailable'},503);
  }finally{
    unbind();
    try{await closeLocDatabase(port)}
    catch{console.error('[LOC named transaction] connection cleanup failed')}
  }
}
