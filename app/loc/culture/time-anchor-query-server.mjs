import {MAX_ROWS,TIME_ANCHOR_MAX_PAGE_ROWS} from '../query/query-batch-size.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {assertZModelAnchorFeatureRows} from '../../../packages/zenstack/import-validation.mjs';
import {publishedLocAccess} from '../permissions/loc-business-grants.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../mcp/native-kysely.mjs';
import {portableRelation} from '../providers/sql-engine-ports.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id));
const UID=/^[A-Za-z0-9]{8}$/;
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
function parseRequest(body){
    if(!KEYS(body,['kind','operation','scope','mode','cursor','limit'])||
       body.kind!=='transaction'||body.operation!=='time-anchors')throw bad();
    const scope=scopeId(body.scope);
    const mode=body.mode||'public',cursor=body.cursor||'',limit=body.limit??MAX_ROWS;
    if(!['public','editor'].includes(mode)||typeof cursor!=='string'||
      (cursor&&!UID.test(cursor))||!Number.isSafeInteger(limit)||limit<1||limit>TIME_ANCHOR_MAX_PAGE_ROWS)
      throw bad();
    return {scope,mode,cursor,limit};
}

function canEdit(session,scope){
  const grants=publishedLocAccess(session.email,{website:true}).grants;
  return grants.includes('global:manage')||grants.includes(scope+':write');
}

export async function handleTimeAnchorQuery(request,env={},{
  database=directMcpKysely,waitUntil,verifySession=verifiedLocWebsiteSession
}={}){
  if(request.method!=='POST')return respond({error:'POST required'},405);
  let operation;
  try{
    sameOrigin(request);
    const raw=await request.text();
    if(raw.length>12000)throw bad();
    operation=parseRequest(JSON.parse(raw));
  }catch(error){return respond({error:'Invalid TimeAnchor query'},error.httpStatus||400)}
  if(operation.mode==='editor'){
    let session;
    try{session=await verifySession(request)}
    catch(error){return respond({error:'LOC Session unavailable'},error.httpStatus||503)}
    if(!canEdit(session,operation.scope))return respond({error:'LOC Scope not authorized'},403);
  }
  let port=null,unbind=()=>{};
  try{
    const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
    if(!primary)throw Error('LOC database unavailable');
    port=await database(env,primary.target_id,{waitUntil});
    unbind=bindLocRequestAbort(port,request.signal);
    if(!port?.db||port.engine!=='postgres')throw Error('LOC PostgreSQL unavailable');
    const result=await (async()=>{
        // Physical table name is derived exclusively from published JS Scope.
        const table=portableRelation(operation.scope+'_anchor',port.engine,
          port.namespace||'silver');
        let query=port.db.selectFrom(table)
          .select(['uid','type','title','description','attr','invisible'])
          .where('type','in',ANCHOR_TYPE_GROUPS.time)
          .orderBy('uid','asc').limit(operation.limit+1);
        if(operation.mode==='public')query=query.where('invisible','=',false);
        if(operation.cursor)query=query.where('uid','>',operation.cursor);
        const rows=await query.execute();
        const page=assertZModelAnchorFeatureRows(rows.slice(0,operation.limit));
        return {data:page,nextCursor:rows.length>operation.limit
          ?String(page.at(-1).uid):null};
      })();
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
