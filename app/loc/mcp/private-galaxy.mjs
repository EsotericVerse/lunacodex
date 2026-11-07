import {executePortableMcp} from '../providers/kysely-mcp.mjs';

// Verified LOC OAuth lives at auth.lo3rwang.cc; SQL lives in this same
// MCP application process. Only a fixed business operation is exposed.
const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const SUBJECT=/^loc_[A-Za-z0-9_-]{32,80}$/;
const ALIAS=/^[a-z][a-z0-9_-]{0,63}$/;
const PR=/(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i;
function invalid(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENT'});}
function unavailable(message,status=503){return Object.assign(new Error(message),{httpStatus:status});}
async function permit(scopeid,token,subject,env,fetchImpl){
  if(!SUBJECT.test(String(subject||''))||typeof token!=='string'||!token.startsWith('eyJ'))
    throw unavailable('Verified LOC MCP OAuth required',401);
  const origin=new URL(String(env.LOC_MCP_AUTHORITY_URL||DEFAULT_AUTHORITY));
  if(origin.protocol!=='https:'||origin.username||origin.password||
    origin.search||origin.hash||!['','/'].includes(origin.pathname))
    throw unavailable('Invalid LOC Authority issuer',503);
  const url=new URL('/v1/mcp/direct-permit/'+scopeid+'/read',origin.origin);
  const response=await fetchImpl(url.href,{
    method:'GET',headers:{authorization:'Bearer '+token,
      origin:'https://loc.lo3rwang.cc',accept:'application/json'},
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw unavailable('LOC Scope read permission denied or unavailable',
    response.status===401||response.status===403?response.status:503);
  const auth=await response.json().catch(()=>null);
  if(auth?.authorized!==true||auth?.subject!==subject||
     auth?.scopeid!==scopeid||auth?.action!=='read'||
     (auth.db_target!==undefined&&!ALIAS.test(auth.db_target)))
    throw unavailable('Invalid LOC Scope authorization response',403);
  return auth;
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
    if(args.site!==undefined&&args.site!=='mcp')throw invalid('PR records must be queried through GitHub');
    offset=args.offset===undefined?0:Number(args.offset);
    maxChars=args.max_chars===undefined?20000:Number(args.max_chars);
    if(!Number.isInteger(offset)||offset<0||offset>1000000||
      !Number.isInteger(maxChars)||maxChars<1||maxChars>40000)
      throw invalid('Invalid Galaxy read paging');
    body={kind:'mcp-read',scopeid,uid:args.uid,site:'mcp'};
  }else{
    if(args.user_requested!==true)throw invalid('只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。');
    const query=String(args.query||'').trim(),limit=args.limit===undefined?5:Number(args.limit);
    if(PR.test(query))throw invalid('請至github頁面找尋PR相關資料！不開放搜尋PR!');
    if(query.length<2||query.length>100||/[\u0000-\u001f\u007f]/.test(query)||
      !Number.isInteger(limit)||limit<1||limit>5)
      throw invalid('Invalid private Galaxy search');
    body={kind:'mcp-search',scopeid,query,limit,user_requested:true};
  }
  // This always rechecks the live LOC Auth Scope grant and selected database.
  // No database password, raw SQL, relation name or caller-chosen alias is sent.
  const authorized=await permit(scopeid,token,subject,env,fetchImpl);
  if(typeof env.locDirectDatabase!=='function')
    throw unavailable('LOC MCP direct Kysely database is not configured');
  const selected=await env.locDirectDatabase(authorized.db_target||'');
  if(!selected?.db||typeof selected.db.selectFrom!=='function'||
     !['postgres','mysql','mssql'].includes(selected.engine))
    throw unavailable('LOC MCP direct SQL driver is unavailable');
  const result=await executePortableMcp(selected.db,body,{
    provider:'loc',me:true,sub:subject,grants:[scopeid+':read']
  },{engine:selected.engine,namespace:selected.namespace});
  const rows=result?.data;
  if(!Array.isArray(rows))throw unavailable('Invalid native MCP query result');
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
