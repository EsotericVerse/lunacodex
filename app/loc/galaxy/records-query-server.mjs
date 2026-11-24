import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {publishedLocAccess} from '../permissions/loc-business-grants.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../mcp/native-kysely.mjs';
import {parseGalaxyRecordTransaction,executeGalaxyRecordTransaction} from '../model/galaxy-record-transactions.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id));
function sameOrigin(request){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)
    throw Object.assign(new Error('Cross-origin request denied'),{httpStatus:403});
}
function canEdit(session,scope){
  const grants=publishedLocAccess(session.email,{website:true}).grants;
  return grants.includes('global:manage')||grants.includes(scope+':write');
}


export async function handleQuery(request,env){
  let operation;
  try{
    sameOrigin(request);
    const raw=await request.text();
    if(raw.length>12000)return respond({error:'Invalid query'},400);
    operation=parseGalaxyRecordTransaction(JSON.parse(raw));
    if(!published.has(operation.scope))return respond({error:'Unavailable Scope'},400);
  }catch(error){return respond({error:'Invalid query'},error.httpStatus||400)}
  if(operation.mode==='editor'){
    let session;
    try{session=await verifiedLocWebsiteSession(request)}
    catch(error){return respond({error:'LOC Session unavailable'},error.httpStatus||503)}
    if(!canEdit(session,operation.scope))return respond({error:'LOC Scope not authorized'},403);
  }
  let port=null,release=()=>{},status=200;
  const initiated=Date.now();
  const receipt={requestedBy:'galaxy',
    model:operation.operation,scope:operation.scope,
    view:operation.view||operation.family,mode:operation.mode,
    requestId:String(request.headers.get('x-request-id')||'').slice(0,80)||null};
  try{
    const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
    if(!primary)throw Error('LOC database unavailable');
    port=await directMcpKysely(env,primary.target_id);
    release=bindLocRequestAbort(port,request.signal);
    if(!port?.db||port.engine!=='postgres')throw Error('LOC database unavailable');
    const data=await executeGalaxyRecordTransaction(port.db,operation);
    return respond({data,query:receipt});
  }catch(error){
    status=error?.httpStatus||503;
    console.error('[LOC fixed record transaction failed]',{...receipt,
      code:String(error?.code||'FAILED').slice(0,40)});
    return respond({error:'Fixed record transaction unavailable',
      query:receipt},status);
  }finally{
    console.info('[LOC fixed record transaction]',{
      ...receipt,status,elapsedMs:Date.now()-initiated});
    release();
    try{await closeLocDatabase(port)}catch{}
  }
}
