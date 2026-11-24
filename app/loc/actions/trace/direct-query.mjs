'use server';
import {headers} from 'next/headers';
import {DATABASE_ACCESS_LIST} from '../../providers/access.js';
import {directMcpKysely,closeLocDatabase} from '../../mcp/native-kysely.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {SCOPE_ROUTE_INDEX} from '../../../modular/routing/scope-route-index.js';
import {publishedLocAccess} from '../../permissions/loc-business-grants.mjs';
import {verifiedLocWebsiteSession} from '../../auth/verified-session.mjs';
import {galaxyReadColumnsFor} from '../../../../packages/zenstack/galaxy-read-models.mjs';

const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&
  row.scope_id!=='loc'&&row.scope_id!=='admin').map(row=>row.scope_id));
function requireScope(value){
  const scope=String(value||'').trim().toLowerCase();
  if(!published.has(scope))throw Error('Invalid Trace Scope');
  return scope;
}
async function openTraceDatabase(scope){
  const incoming=await headers();
  const request=new Request('https://loc.local/trace-query',{
    headers:{cookie:incoming.get('cookie')||''}
  });
  const session=await verifiedLocWebsiteSession(request);
  const grants=publishedLocAccess(session.email,{website:true}).grants;
  if(!grants.includes('global:manage')&&!grants.includes(scope+':write'))
    throw Error('LOC Scope not authorized');
  const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
  if(!primary)throw Error('LOC database unavailable');
  const port=await directMcpKysely(process.env,primary.target_id);
  return {port,request};
}
async function withTraceDatabase(scope,work){
  const {port}=await openTraceDatabase(scope);
  try{
    const table=name=>portableRelation(scope+'_'+name,port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    return await work(port.db,table);
  }finally{await closeLocDatabase(port)}
}
export async function readTracePoint(scope,uid){
  const id=requireScope(scope),key=String(uid||'');
  if(!/^[A-Za-z0-9]{8}$/.test(key))throw Error('Invalid Point UID');
  return withTraceDatabase(id,async(db,table)=>
    (await db.selectFrom(table('anchor')).select(['uid','attr'])
      .where('uid','=',key).where('type','=','point').executeTakeFirst())||null);
}
export async function readTraceRouteUids(scope,uids){
  const id=requireScope(scope),ids=[...new Set((Array.isArray(uids)?uids:[]).map(String))];
  if(!ids.length||ids.length>80||ids.some(uid=>!/^[A-Za-z0-9]{8}$/.test(uid)))
    throw Error('Invalid Trace route UID list');
  return withTraceDatabase(id,async(db,table)=>db.selectFrom(table('anchor'))
    .select('uid').where('type','=','path').where('uid','in',ids).limit(81).execute());
}
export async function readTimelineArticlePage(scope,startDate,nextDate,offset,limit){
  const id=requireScope(scope),start=String(startDate||''),end=String(nextDate||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||
    start>=end||!Number.isSafeInteger(offset)||offset<0||offset>100000||
    !Number.isSafeInteger(limit)||limit<1||limit>500)
    throw Error('Invalid Trace article page');
  return withTraceDatabase(id,async(db,table)=>db.selectFrom(table('galaxy'))
    .select(galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor'))
    .where('date','>=',start).where('date','<',end)
    .orderBy('date','asc').orderBy('createtime','asc')
    .limit(limit).offset(offset).execute());
}
