import {decodeLocCache} from '../../loc/runtime-cache-fields.mjs';

// Public summaries retry only availability failures: never turn an
// authorization, invalid-parameter or disabled-ISR response into a failover.
export function isAvailabilityFailure(result){
  const error=result?.error||result;
  const status=Number(result?.status||error?.status||0);
  if(status===429||status>=500)return true;
  if(status&&status<500)return false;
  const code=String(error?.code||'');
  if(code.startsWith('08')||code==='53300'||code==='PGRST000')return true;
  return /network|fetch failed|failed to fetch|timeout|timed out|connection|econn|unavailable|aborterror/i
    .test(String(error?.message||error||''));
}
export async function tryPublicSources(sources,run){
  for(let i=0;i<sources.length;i++){
    const source=sources[i];
    try{
      const result=await run(source.schema());
      if(result?.retryable&&i+1<sources.length)continue;
      return {...result,source:source.id};
    }catch(error){
      if(!isAvailabilityFailure(error)||i+1===sources.length)throw error;
    }
  }
  throw new Error('No public summary source configured');
}

export async function readIsrSummary(db,{origin,args}){
  const setting=await db.from('manage')
    .select('caches').eq('id','admin').single();
  if(setting.error)return {retryable:isAvailabilityFailure(setting),error:'Public ISR settings unavailable'};
  const runtime=decodeLocCache(setting.data?.caches);
  const chosen=Array.isArray(runtime?.isr_domains)
    ?runtime.isr_domains.find(item=>item.origin===runtime.cache_provider||item.id===runtime.cache_provider):null;
  if(runtime?.cache_mode!=='isr'||String(chosen?.origin||'').trim()!==origin)
    return {disabled:true,error:'ISR not enabled for this domain'};
  const result=await db.analytics(args);
  if(result.error)return {retryable:isAvailabilityFailure(result),error:'Public summary unavailable'};
  return {data:result.data};
}

export async function readPublishedBootstrap(sources){
  const result=await tryPublicSources(sources,async client=>{
    const response=await client.publicAction('read_app_bootstrap',
      {p_scope_id:'loc',p_page_name:'index'});
    if(response.error)return {error:'Cannot publish public Bootstrap',retryable:isAvailabilityFailure(response)};
    if(!response.data||!Array.isArray(response.data.registry))return {error:'Invalid public Bootstrap',retryable:false};
    return {data:response.data,client};
  });
  if(result.error)throw new Error(result.error);
  return result;
}
