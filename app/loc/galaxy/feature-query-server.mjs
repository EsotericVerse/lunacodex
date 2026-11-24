import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../mcp/native-kysely.mjs';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction,GALAXY_FEATURE_MODELS} from '../model/galaxy-feature-transactions.mjs';
import {checkSearchQos} from '../providers/search-qos.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
function sameOrigin(request){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)
    throw Object.assign(new Error('Cross-origin request denied'),{httpStatus:403});
}

export async function handleGalaxyFeatureQuery(request,env){
  let operation;
  try{
    sameOrigin(request);
    const raw=await request.text();
    if(raw.length>12000)return respond({error:'Invalid Galaxy query'},400);
    operation=parseGalaxyFeatureTransaction(JSON.parse(raw));
  }catch(error){return respond({error:'Invalid Galaxy query'},error.httpStatus||400)}
  // Parse and validate the fixed model before any SQL connection.
  if(operation.category?.type==='keyword'&&process.versions?.workerd){
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
  const requestId=String(request.headers.get('x-request-id')||'').slice(0,80);
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
    scope:operation.scope,result:operation.result,requestId:requestId||null,
    requestPath};
  let status=200;
  try{
    const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
    if(!primary)throw Error('LOC database unavailable');
    port=await directMcpKysely(env,primary.target_id);
    unbind=bindLocRequestAbort(port,request.signal);
    if(!port?.db||port.engine!=='postgres')throw Error('LOC PostgreSQL unavailable');
    const data=await executeGalaxyFeatureTransaction(port.db,operation);
    return respond({data,query:receipt});
  }catch(error){
    status=503;
    console.error('[LOC Galaxy feature failed]',{...receipt,
      code:String(error?.code||'FAILED').slice(0,40)});
    return respond({error:'LOC Galaxy feature transaction unavailable',
      query:receipt},status);
  }finally{
    console.info('[LOC Galaxy feature transaction]',{
      ...receipt,status,elapsedMs:Date.now()-started});
    unbind();
    try{await closeLocDatabase(port)}
    catch{console.error('[LOC Galaxy feature] connection cleanup failed')}
  }
}
