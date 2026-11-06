import {withLocCors,locCorsPreflight} from '../../../../_cors';
import {publicNumericSources,validScopeId} from '../../../../_server';
import {tryPublicSources,readIsrSummary} from '../../../../_numeric-failover.mjs';

// Provider-neutral HTTP cache contract. A CDN/Worker may honor s-maxage=3600.
// ISR is an optional separate origin; GitHub Pages never executes this route.
const CACHE_HEADERS={'Cache-Control':'public, s-maxage=3600, stale-while-revalidate=3600',
  'Cloudflare-CDN-Cache-Control':'public, s-maxage=3600'};
const NO_CACHE={'Cache-Control':'no-store'};
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const day=value=>DAY.test(value||'')?value:null;
const kinds=new Set(['culture','statistics','earliest','loc-statistics']);
function reply(request,data,status=200,headers=status===200?CACHE_HEADERS:NO_CACHE){
  return withLocCors(Response.json(data,{status,headers}),request);
}
export async function GET(request,{params}){
  const {scopeId,kind}=await params;
  if(!validScopeId(scopeId)||!kinds.has(kind)||scopeId==='local')
    return reply(request,{error:'Unsupported public summary'},404);
  const url=new URL(request.url);
  if([...url.searchParams.keys()].some(key=>!['startDate','endDate','includeUndated'].includes(key)))
    return reply(request,{error:'Invalid parameters'},400);
  const start=url.searchParams.get('startDate')||'',end=url.searchParams.get('endDate')||'';
  if((start&&!day(start))||(end&&!day(end))||start&&end&&start>end)
    return reply(request,{error:'Invalid date range'},400);
  // The Kysely Gateway computes bounded numeric aggregates lazily.
  const view={culture:'daily',statistics:'overview',earliest:'earliest',
    'loc-statistics':'loc'}[kind];
  if(view==='loc'&&scopeId!=='loc')
    return reply(request,{error:'Unsupported LOC statistics scope'},404);
  const args={
    p_scope_id:scopeId,p_view:view,p_start:day(start),p_end:day(end),
    p_options:view==='daily'?{includeUndated:url.searchParams.get('includeUndated')==='true'}:{}
  };
  // Public numeric data uses one direct analytics action, never a stored RPC.
  // No admin cookies, API keys or service secrets enter this public path.
  let outcome;
  try{
    outcome=await tryPublicSources(publicNumericSources(),db=>
      readIsrSummary(db,{origin:url.origin,args}));
  }catch{
    return reply(request,{error:'Public summary unavailable'},503);
  }
  if(outcome.error)return reply(request,{error:outcome.error},503);
  const data=outcome.data;
  // Do not give a potentially lagging replica the primary's hour-long CDN TTL.
  const sourceHeaders={...(outcome.source==='backup'
    ?{'Cache-Control':'public, s-maxage=120, stale-while-revalidate=180',
      'Cloudflare-CDN-Cache-Control':'public, s-maxage=120'}
    :CACHE_HEADERS),'X-LOC-Data-Source':outcome.source};
  if(kind==='culture')return reply(request,Array.isArray(data)?data:[],200,sourceHeaders);
  if(kind==='earliest')return reply(request,typeof data==='string'?data:'',200,sourceHeaders);
  if(kind==='statistics')return reply(request,{
    earliest:String(data?.earliest||''),
    rows:Array.isArray(data?.rows)?data.rows:[],
    categories:Array.isArray(data?.categories)?data.categories:[],
    aliases:Array.isArray(data?.aliases)?data.aliases:[]
  },200,sourceHeaders);
  return reply(request,{
    earliest:String(data?.earliest||''),
    scopes:Array.isArray(data?.scopes)?data.scopes:[],
    rows:Array.isArray(data?.rows)?data.rows:[]
  },200,sourceHeaders);
}
export function OPTIONS(request){return locCorsPreflight(request);}
