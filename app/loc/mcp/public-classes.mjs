// Public shared Class lookup within the existing LOC application runtime.
// A Scope's own keyword_meta sharing flags, not arbitrary requested SQL
// or caller identity, determine the only visible Class rows.
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {directMcpKysely} from './native-kysely.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/;
const jsonHeaders={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
function reply(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:jsonHeaders});
}
export async function handleNativePublicClasses(request,env={},{
  database=directMcpKysely
}={}){
  if(request.method!=='GET')return reply({error:'Method not allowed'},405);
  if(new URL(request.url).hostname!=='mcp.lo3rwang.cc')
    return reply({error:'Not found'},404);
  const url=new URL(request.url);
  const scope=String(url.searchParams.get('scopeid')||'');
  if(!SCOPE.test(scope)||[...url.searchParams.keys()].some(k=>k!=='scopeid'))
    return reply({error:'Invalid Scope'},400);
  try{
    // Public directory always reads the trusted default source, never a
    // browser-selected database ID, credentials or arbitrary relation.
    const port=await database(env);
    const namespace=port.namespace||'silver';
    const control=portableRelation(scope,port.engine,namespace);
    const anchor=portableRelation(scope+'_anchor',port.engine,namespace);
    const config=await port.db.selectFrom(control)
      .select('keyword_meta').where('id','=',scope).limit(1).executeTakeFirst();
    let meta=config?.keyword_meta||{};
    if(typeof meta==='string'){
      try{meta=JSON.parse(meta);}catch{meta={};}
    }
    const shared=Object.entries(meta?.class_shares||{})
      .filter(([uid,flag])=>UID.test(uid)&&flag===true)
      .slice(0,100).map(([uid])=>uid);
    if(!shared.length)return reply({data:[]});
    const rows=await port.db.selectFrom(anchor)
      .select(['uid','title']).where('type','=','class')
      .where('uid','in',shared).orderBy('title','asc').limit(100).execute();
    const allowed=new Set(shared);
    return reply({data:rows.filter(row=>allowed.has(String(row.uid||'')))
      .map(row=>({scopeId:scope,classUid:row.uid,name:row.title}))});
  }catch(error){
    console.error('[LOC public Class directory]',String(error?.message||error));
    return reply({error:'Public Class directory unavailable'},503);
  }
}
