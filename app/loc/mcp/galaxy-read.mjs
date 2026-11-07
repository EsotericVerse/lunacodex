import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {portableContainsTerm} from '../providers/portable-search.mjs';

// Public UID reads use the same independent LOC Kysely SQL Gateway as private
// MCP operations, but never forward any OAuth token or database credentials.
const PUBLIC_SCOPE_IDS=Object.freeze(SCOPE_ROUTE_INDEX.filter(row=>row.active&&row.scope_id!=='loc')
  .map(row=>row.scope_id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id)));
const UID=/^[A-Za-z0-9]{8}$/;
function bad(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENT'});}
function scopeAllowed(value){
  const id=value??PUBLIC_SCOPE_IDS[0];
  if(!PUBLIC_SCOPE_IDS.includes(id))throw bad('Only configured public Galaxy Scopes are available');
  return id;
}
function gatewayUrl(env){
  const raw=String(env.LOC_MCP_SQL_GATEWAY_URL||env.LOC_SQL_GATEWAY_URL||'');
  if(!raw)throw Error('LOC public Kysely SQL Gateway is not configured');
  let url;try{url=new URL(raw)}catch{throw Error('Invalid LOC Kysely Gateway URL')}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     /\/rest\/v1(?:\/|$)|\/functions\/v1\//.test(url.pathname))
    throw Error('LOC public read requires an independent HTTPS Kysely Gateway');
  return url.toString();
}
async function galaxyRows({columns,filters=[],or=[],orders=[],limit=1,offset=0},
  scopeid,env={},fetchImpl=globalThis.fetch){
  const body={kind:'query',schema:'silver',table:scopeid+'_galaxy',
    operation:'select',columns,filters,or,orders,limit,offset,target:'configured'};
  const res=await fetchImpl(gatewayUrl(env),{
    method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(8500),
    redirect:'error',cache:'no-store'
  });
  if(!res.ok)throw Object.assign(new Error('LOC public Galaxy read unavailable (HTTP '+res.status+')'),
    {code:'BACKEND_UNAVAILABLE'});
  const payload=await res.json().catch(()=>null);
  if(!Array.isArray(payload?.data))
    throw Object.assign(new Error('LOC Galaxy returned an invalid response'),{code:'BACKEND_UNAVAILABLE'});
  return payload.data;
}
export async function searchMemory(args={},env={},fetchImpl=globalThis.fetch){
  if(args.user_requested!==true)
    throw bad('只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。');
  const scopeid=scopeAllowed(args.scopeid);
  if(typeof args.query!=='string')throw bad('query is required');
  const term=args.query.trim();
  if(/(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i.test(term))
    throw bad('請至github頁面找尋PR相關資料！不開放搜尋PR!');
  if(term.length<2||term.length>100||/[\u0000-\u001f\u007f]/.test(term))
    throw bad('query must contain 2–100 characters without control characters');
  const limit=args.limit===undefined?10:Number(args.limit);
  const offset=args.offset===undefined?0:Number(args.offset);
  if(!Number.isInteger(limit)||limit<1||limit>20)throw bad('limit must be between 1 and 20');
  if(!Number.isInteger(offset)||offset<0||offset>500)throw bad('offset must be between 0 and 500');
  const termLiteral=portableContainsTerm(term);
  const rows=await galaxyRows({
    columns:['uid','title','date','createtime'],
    filters:[{column:'search',operator:'eq',value:true}],
    or:['(title.contains."'+termLiteral+'",content.contains."'+termLiteral+'")'],
    orders:[{column:'date',ascending:false},{column:'createtime',ascending:false}],
    limit,offset
  },scopeid,env,fetchImpl);
  return {scopeid,visibility:'public',query:term,limit,offset,
    results:rows.map(row=>({uid:String(row.uid||'').trim(),title:row.title||'',
      date:row.date||null,createtime:row.createtime||null})),
    has_more:rows.length===limit};
}
export async function readMemory(args={},env={},fetchImpl=globalThis.fetch){
  const scopeid=scopeAllowed(args.scopeid);
  const uid=String(args.uid||'').trim();
  if(!UID.test(uid))throw bad('uid must be an 8-character, case-sensitive Base62 ID');
  const offset=args.offset===undefined?0:Number(args.offset);
  const maxChars=args.max_chars===undefined?20000:Number(args.max_chars);
  if(!Number.isInteger(offset)||offset<0||offset>1000000)throw bad('offset must be 0–1000000');
  if(!Number.isInteger(maxChars)||maxChars<1||maxChars>40000)
    throw bad('max_chars must be 1–40000');
  const rows=await galaxyRows({
    columns:['uid','title','content','date','createtime','site','url'],
    filters:[{column:'uid',operator:'eq',value:uid},{column:'list',operator:'eq',value:true}],
    limit:1
  },scopeid,env,fetchImpl);
  if(!rows.length)return {found:false,scopeid,uid,visibility:'public'};
  const row=rows[0],content=String(row.content||'');
  return {found:true,scopeid,visibility:'public',uid:String(row.uid||'').trim(),
    title:row.title||'',date:row.date||null,createtime:row.createtime||null,
    site:row.site||null,url:row.url||null,content:content.slice(offset,offset+maxChars),
    offset,total_chars:content.length,next_offset:offset+maxChars<content.length?offset+maxChars:null};
}
