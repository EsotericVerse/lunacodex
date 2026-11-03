import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
// LOC MCP public Galaxy reads through existing Supabase PostgREST and anonymous RLS.
// A publishable key is public, not a management or write credential.
const DEFAULT_SUPABASE_URL='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLISHABLE_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';
const PUBLIC_SCOPE_IDS=Object.freeze(SCOPE_ROUTE_INDEX.filter(row=>row.active&&row.scope_id!=='loc')
  .map(row=>row.scope_id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id)));
const UID=/^[A-Za-z0-9]{8}$/;

function clientError(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENT'});}
function publicSource(env){
  const base=new URL(String(env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_SUPABASE_URL));
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||
    base.pathname!=='/')throw new Error('Invalid LOC public Supabase source');
  const apikey=String(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_PUBLISHABLE_KEY);
  if(!apikey)throw new Error('LOC public Supabase publishable key is missing');
  return {base:base.origin,apikey};
}
async function galaxyRows(filters,scopeid,env={},fetchImpl=globalThis.fetch){
  const {base,apikey}=publicSource(env);
  const url=new URL(base+'/rest/v1/'+scopeid+'_galaxy');
  for(const [key,value] of Object.entries(filters))url.searchParams.set(key,String(value));
  // Do not forward the caller's Clerk token. Supabase enforces anonymous RLS.
  const res=await fetchImpl(url.href,{
    method:'GET',headers:{apikey,'accept-profile':'silver',accept:'application/json'},
    signal:AbortSignal.timeout(8500),redirect:'manual',cache:'no-store'
  });
  if(!res.ok)throw Object.assign(new Error('LOC public Galaxy read unavailable (HTTP '+res.status+')'),
    {code:'BACKEND_UNAVAILABLE'});
  const rows=await res.json();
  if(!Array.isArray(rows))throw Object.assign(new Error('LOC Galaxy returned an invalid response'),
    {code:'BACKEND_UNAVAILABLE'});
  return rows;
}

function scopeAllowed(scopeid){
  const id=scopeid??PUBLIC_SCOPE_IDS[0];
  if(!PUBLIC_SCOPE_IDS.includes(id))
    throw clientError('Only configured public Galaxy Scopes are available');
  return id;
}
function escapeIlike(value){
  // PostgREST logic-tree string: escape quotes and backslashes, then SQL LIKE
  // wildcards. The MCP caller never supplies an operator or column name.
  return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')
    .replace(/([%_*])/g,'\\$1');
}
export async function searchMemory(args={},env={},fetchImpl=globalThis.fetch){
  const scopeid=scopeAllowed(args.scopeid);
  if(typeof args.query!=='string')throw clientError('query is required');
  const term=args.query.trim();
  if(term.length<2||term.length>100||/[\u0000-\u001f\u007f]/.test(term))
    throw clientError('query must contain 2–100 characters without control characters');
  const limit=args.limit===undefined?10:Number(args.limit);
  if(!Number.isInteger(limit)||limit<1||limit>20)throw clientError('limit must be between 1 and 20');
  const offset=args.offset===undefined?0:Number(args.offset);
  if(!Number.isInteger(offset)||offset<0||offset>500)
    throw clientError('offset must be between 0 and 500');
  const pattern='"*'+escapeIlike(term)+'*"';
  const rows=await galaxyRows({
    select:'uid,title,date,createtime',
    or:'(title.ilike.'+pattern+',content.ilike.'+pattern+')',
    search:'eq.true',order:'date.desc.nullslast,createtime.desc.nullslast',
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
  if(!UID.test(uid))throw clientError('uid must be an 8-character, case-sensitive Base62 ID');
  const offset=args.offset===undefined?0:Number(args.offset);
  const maxChars=args.max_chars===undefined?20000:Number(args.max_chars);
  if(!Number.isInteger(offset)||offset<0||offset>1000000)throw clientError('offset must be 0–1000000');
  if(!Number.isInteger(maxChars)||maxChars<1||maxChars>40000)
    throw clientError('max_chars must be 1–40000');
  const rows=await galaxyRows({
    select:'uid,title,content,date,createtime,site,url',uid:'eq.'+uid,
    list:'eq.true',limit:1
  },scopeid,env,fetchImpl);
  if(!rows.length)return {found:false,scopeid,uid,visibility:'public'};
  const row=rows[0],content=String(row.content||'');
  return {found:true,scopeid,visibility:'public',uid:String(row.uid||'').trim(),
    title:row.title||'',date:row.date||null,createtime:row.createtime||null,
    site:row.site||null,url:row.url||null,content:content.slice(offset,offset+maxChars),
    offset,total_chars:content.length,next_offset:offset+maxChars<content.length?offset+maxChars:null};
}
