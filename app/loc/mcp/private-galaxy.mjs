// Private Galaxy is a LOC data operation; Auth only establishes the user.
// All access decisions are made from the existing Neon api.manage table.
import {executePortableMcp} from '../providers/kysely-mcp.mjs';
import {directMcpKysely} from './native-kysely.mjs';
import {createScopedLocClient} from '../../../zenstack/client.mjs';
import {loadMcpLocAccess,VerifiedLocUserInfoSchema} from './access-roles.mjs';

const AUTH='https://auth.lo3rwang.cc';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const PR=/(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i;
function invalid(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENT'})}
function denied(message,status=403){return Object.assign(new Error(message),{httpStatus:status})}
async function getVerifiedPrincipal(token,subject,fetchImpl){
  if(typeof subject!=='string'||subject.length<8||subject.length>128||
     typeof token!=='string'||!token)throw denied('LOC OAuth required',401);
  let res;
  try{
    res=await fetchImpl(AUTH+'/api/auth/oauth2/userinfo',{
      method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)
    });
  }catch{throw denied('LOC OAuth UserInfo unavailable',503)}
  if(res?.status===429)throw denied('LOC OAuth UserInfo rate limited',429);
  if(res?.status===401||res?.status===403)
    throw denied('LOC OAuth identity verification failed',401);
  if(!res?.ok)throw denied('LOC OAuth UserInfo unavailable',503);
  const checked=VerifiedLocUserInfoSchema.safeParse(await res.json().catch(()=>null));
  if(!checked.success||checked.data.sub!==subject)
    throw denied('LOC verified identity required',401);
  return checked.data.email.toLowerCase().trim();
}
export async function privateGalaxyLink(args={},token,subject,env={},
  fetchImpl=globalThis.fetch){
  if(args.source!==undefined)throw invalid('Galaxy Link source is fixed to mcp');
  if(!SCOPE.test(String(args.scopeid||'')))throw invalid('Invalid private Galaxy Scope');
  const scopeid=args.scopeid,action=String(args.action||'');
  if(!['read','search'].includes(action))throw invalid('Unsupported direct Galaxy action');
  let body,offset=0,maxChars=20000;
  if(action==='read'){
    if(!UID.test(String(args.uid||'')))throw invalid('Invalid case-sensitive UID');
    const requestedSite=args.site??'mcp';
    if(requestedSite!=='mcp'&&requestedSite!=='LOC')
      throw invalid('Unsupported private Galaxy site');
    // Project documentation is owned by this Scope, not all Galaxy tables.
    if(requestedSite==='LOC'&&scopeid!=='lo3rwang')
      throw invalid('LOC documents require lo3rwang Scope');
    offset=args.offset===undefined?0:Number(args.offset);
    maxChars=args.max_chars===undefined?20000:Number(args.max_chars);
    if(!Number.isInteger(offset)||offset<0||offset>1000000||
       !Number.isInteger(maxChars)||maxChars<1||maxChars>40000)
      throw invalid('Invalid Galaxy read paging');
    body={kind:'mcp-read',scopeid,uid:args.uid,site:requestedSite};
  }else{
    if(args.site!==undefined)throw invalid('site is only available for private read');
    if(args.user_requested!==true)throw invalid('Conversation search must be explicitly requested');
    const query=String(args.query||'').trim(),limit=args.limit===undefined?5:Number(args.limit);
    if(PR.test(query))throw invalid('GitHub PR content is not searchable through Galaxy');
    if(query.length<2||query.length>100||/[\u0000-\u001f\u007f]/.test(query)||
       !Number.isInteger(limit)||limit<1||limit>5)
      throw invalid('Invalid private Galaxy search');
    body={kind:'mcp-search',scopeid,query,limit,user_requested:true};
  }
  const email=await getVerifiedPrincipal(token,subject,fetchImpl);
  const selected=await directMcpKysely(env);
  const {db,engine,namespace}=selected;
  const rights=await loadMcpLocAccess(db,email,{
    dialect:selected.dialect,engine:selected.engine
  });
  const canRead=rights.grants.includes('global:manage')||
    rights.grants.includes(scopeid+':read');
  if(!canRead)throw denied('LOC Scope permission denied');
  const claims={provider:'loc',sub:subject,email,me:rights.canWrite,grants:rights.grants};
  // Authorization and Scope resolution MUST precede scoped model construction.
  // Use one already-trusted PostgreSQL dialect for the Galaxy ZModel query
  // builder; external mapped tables retain the existing direct Kysely path.
  const hasFieldMap=Boolean(selected.fieldMap&&
    Object.keys(selected.fieldMap).length);
  const useScopedZModel=engine==='postgres'&&Boolean(selected.dialect)&&
    !selected.tableName&&!hasFieldMap;
  const queryDb=useScopedZModel?
    createScopedLocClient({dialect:selected.dialect,scopeId:scopeid,
      namespace:namespace||'silver'}).$qb:db;
  const result=await executePortableMcp(queryDb,body,claims,{engine,namespace,
    tableName:selected.tableName,fieldMap:selected.fieldMap,
    scopedZModel:useScopedZModel});
  const rows=result?.data;
  if(!Array.isArray(rows))throw denied('Invalid native MCP query result',503);
  if(action==='search')return {scopeid,results:rows.map(r=>({
    uid:r.uid,title:r.title,createtime:r.createtime
  }))};
  if(!rows.length)return {found:false,scopeid,uid:args.uid};
  const row=rows[0],content=String(row.content||'');
  return {found:true,scopeid,uid:row.uid,title:row.title,date:row.date,
    createtime:row.createtime,site:row.site,url:row.url,
    content:content.slice(offset,offset+maxChars),offset,total_chars:content.length,
    next_offset:offset+maxChars<content.length?offset+maxChars:null};
}
