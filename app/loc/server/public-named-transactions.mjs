// Only fixed feature operations may cross this public entry. The existing
// legacy generic SELECT executor is NOT directly exposed as an HTTP route.
import {handleNativePublicQuery} from './native-public-query.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {publishedLocAccess} from '../permissions/loc-business-grants.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../mcp/native-kysely.mjs';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction} from '../model/galaxy-feature-transactions.mjs';
import {checkSearchQos} from '../providers/search-qos.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id));
const UID=/^[A-Za-z0-9]{8}$/;
const ACTIONS=new Set(['block_list','hero_block','read_scope_page_copy',
  'search_scope_trace_place_names']);
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
  if(!KEYS(body,['kind','operation','scope','mode','cursor','limit','args','name'])||
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
  if(body.operation==='analytics'){
    if(!KEYS(body,['kind','operation','args'])||!OBJECT(body.args)||
      typeof body.args.p_view!=='string')throw bad();
    // The existing fixed analytics validator checks all named selectors and
    // published Scopes before it opens SQL; no projection/table is accepted.
    return {operation:'analytics',args:body.args};
  }
  if(body.operation==='action'){
    if(!KEYS(body,['kind','operation','name','args'])||
      !ACTIONS.has(body.name)||!OBJECT(body.args))throw bad();
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
  if(operation.operation==='time-anchors'&&operation.mode==='editor'||
     operation.operation==='action'&&operation.name==='search_scope_trace_place_names'){
    let session;
    try{session=await verifySession(request)}
    catch(error){return respond({error:'LOC Session unavailable'},error.httpStatus||503)}
    let scope;
    try{scope=operation.operation==='time-anchors'?operation.scope:
      scopeId(operation.args.p_scope_id)}
    catch{return respond({error:'Unavailable Scope'},400)}
    if(!canEdit(session,scope))return respond({error:'LOC Scope not authorized'},403);
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
    const modelName={culture:'GalaxyCulture',statics:'GalaxyStatistics',
      search:'GalaxySearch',trace:'GalaxyTrace'}[operation.feature];
    const receipt={requestedBy:operation.feature,model:modelName,
      scope:operation.scope,result:operation.result,ray:ray||null};
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
  if(operation.operation!=='time-anchors'){
    // Bridge only fixed, already-validated names to existing feature
    // executors. Generic schema/table/columns/filters cannot reach them.
    const body=operation.operation==='analytics'
      ?{kind:'analytics',args:operation.args}
      :{kind:'public-action',name:operation.name,args:operation.args};
    const delegated=new Request(request.url,{method:'POST',headers:request.headers,
      body:JSON.stringify(body),signal:request.signal});
    return handleNativePublicQuery(delegated,env,{database,waitUntil});
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
        const page=rows.slice(0,operation.limit);
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
