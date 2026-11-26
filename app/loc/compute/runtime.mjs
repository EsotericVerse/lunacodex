import {sql} from 'kysely';
import {COMPUTE_PROTOCOL,COMPUTE_MAX_BYTES,COMPUTE_KINDS,COMPUTE_MIN_ROWS,byteLength} from './contract.mjs';

// Vercel injects an absolute private Service Binding URL. Keep the transport
// adapter here so the compute engine and its payload contract remain shared
// with Cloudflare's Durable Object Container.
function normalizedServiceBase(value){
  try{
    const url=new URL(String(value||'').trim());
    if(!['http:','https:'].includes(url.protocol)||!url.hostname||
      url.username||url.password||url.search||url.hash)return null;
    url.pathname=url.pathname.endsWith('/')?url.pathname:url.pathname+'/';
    return url;
  }catch{return null;}
}
export function createComputeBinding({serviceUrl='',cloudflareBinding=null,
  fetcher=globalThis.fetch}={}){
  const base=normalizedServiceBase(serviceUrl);
  if(base&&typeof fetcher==='function'){
    return Object.freeze({
      provider:'service',
      fetch(path,init){
        const relative=String(path||'').replace(/^\\/+/, '');
        return fetcher(new URL(relative,base),init);
      }
    });
  }
  if(cloudflareBinding&&typeof cloudflareBinding.getByName==='function'){
    return Object.freeze({
      provider:'cloudflare',
      fetch(path,init){
        const relative=String(path||'').replace(/^\\/+/, '');
        return cloudflareBinding.getByName('loc-compute')
          .fetch('http://loc-compute/'+relative,init);
      }
    });
  }
  return null;
}

// Same existing runtime JSON settings envelope as Hyperdrive.
export async function readLocContainerMode(db){
  const result=await sql`select coalesce((select caches->'runtime'->>'container_enabled'
    from silver.loc where id='loc'),'true') as enabled`.execute(db);
  if(!result.rows?.length)throw Error('LOC Container mode unavailable');
  return String(result.rows[0].enabled).toLowerCase()!=='false';
}
export async function writeLocContainerMode(db,enabled){
  if(typeof enabled!=='boolean')throw TypeError('Invalid Container mode');
  const result=await sql`update silver.loc set caches=jsonb_set(
    case when jsonb_typeof(caches)='object' then caches else '{}'::jsonb end,
    '{runtime}',(case when jsonb_typeof(caches->'runtime')='object'
      then caches->'runtime' else '{}'::jsonb end)
      ||jsonb_build_object('container_enabled',${enabled}),true)
    where id='loc' returning id`.execute(db);
  if(result.rows?.length!==1)throw Error('LOC Container mode unavailable');
  return enabled;
}
export async function containerBinding(env=process.env){
  const service=createComputeBinding({serviceUrl:env?.LOC_COMPUTE_URL});
  if(service)return service;
  try{
    const {getCloudflareContext}=await import('@opennextjs/cloudflare');
    const cloudflareEnv=(await getCloudflareContext({async:true}))?.env;
    return createComputeBinding({cloudflareBinding:cloudflareEnv?.LOC_COMPUTE});
  }catch{return null;}
}
export async function containerMode(db){
  return {enabled:await readLocContainerMode(db),available:Boolean(await containerBinding())};
}
export async function probeContainer(binding){
  if(!binding)return false;
  try{
    const response=await binding.fetch('/health',
      {signal:AbortSignal.timeout(30000)});
    return response.ok&&(await response.text())===COMPUTE_PROTOCOL;
  }catch{return false;}
}
export async function computeClient(db){
  const binding=await containerBinding();
  if(!binding)return null;
  try{if(!await readLocContainerMode(db))return null;}catch{return null;}
  return async(kind,payload)=>{
    if(!COMPUTE_KINDS.includes(kind))throw Error('Invalid compute operation');
    const body=JSON.stringify({protocol:COMPUTE_PROTOCOL,kind,payload});
    if(new TextEncoder().encode(body).byteLength>COMPUTE_MAX_BYTES)return null;
    try{
      const response=await binding.fetch('/compute',{
        method:'POST',headers:{'content-type':'application/json'},body,
        signal:AbortSignal.timeout(45000)
      });
      if(!response.ok){await response.body?.cancel();return null;}
      const result=await response.json();
      return result?.protocol===COMPUTE_PROTOCOL?result.data:null;
    }catch{return null;}
  };
}
function validateState(before,after,rows){
  if(!after||after.scanMode!==before.scanMode||after.fingerprint!==before.fingerprint||
    after.scanned!==before.scanned)return false;
  for(const key of ['parsed','matchedDocuments','itemMatches','occurrences']){
    if(!Number.isSafeInteger(after[key])||after[key]<before[key])return false;
  }
  if(after.parsed-before.parsed>rows||after.matchedDocuments-before.matchedDocuments>rows)return false;
  for(const key of ['itemCounts','itemDocuments','groupCounts','groupDocuments','patternCounts']){
    if(!after[key]||Object.keys(after[key]).length!==Object.keys(before[key]).length)return false;
    for(const id of Object.keys(before[key]))
      if(!Number.isSafeInteger(after[key][id])||after[key][id]<before[key][id])return false;
  }
  return true;
}
export function keywordComputeAbsorber(compute){
  if(!compute)return null;
  let unavailable=false;
  return async({items,groups,patterns,minChars,state,rows})=>{
    if(unavailable||rows.length<COMPUTE_MIN_ROWS)return null;
    // Ordered slices preserve the existing group tie-break and all checkpoint
    // counters. Apply nothing locally until every remote slice is verified.
    let next=state,offset=0;
    const encoder=new TextEncoder();
    const context={items,groups,patterns,minChars};
    while(offset<rows.length){
      const fixed=byteLength({...context,state:next,rows:[]})+256;
      let end=offset,bytes=fixed;
      while(end<rows.length){
        const size=encoder.encode(JSON.stringify(rows[end])).byteLength+1;
        if(bytes+size>COMPUTE_MAX_BYTES)break;
        bytes+=size;end++;
      }
      if(end===offset)return null;
      const result=await compute('keyword',{...context,state:next,rows:rows.slice(offset,end)});
      if(!validateState(next,result,end-offset)){unavailable=true;return null;}
      next=result;offset=end;
    }
    return next;
  };
}
