// Private LOC index transport. Works with any SQL target; the index is a
// candidate filter only, NEVER a source of article content or authorization.
// Missing or incomplete indexes leave existing Kysely SQL search unchanged.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SOURCE=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UID=/^[A-Za-z0-9_.~-]{1,128}$/;

function service(){
  const address=String(Deno.env.get('LOC_SEARCH_INDEX_URL')||'').trim();
  const secret=String(Deno.env.get('LOC_SEARCH_INDEX_SECRET')||'');
  if(!address||secret.length<32)return null;
  let url;try{url=new URL(address);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     !['','/'].includes(url.pathname))return null;
  return {url:url.origin,secret};
}
async function requestIndex(path,method,body){
  const options=service();
  if(!options)return null;
  try{
    const response=await fetch(options.url+path,{
      method,headers:{'content-type':'application/json',
        authorization:'Bearer '+options.secret},
      body:JSON.stringify(body),redirect:'error',
      signal:AbortSignal.timeout(1800)
    });
    if(!response.ok)throw new Error('LOC Index HTTP '+response.status);
    return await response.json();
  }catch(error){
    // Failure must fall back to SQL. No client credential, UID or text returned.
    console.warn('[loc-search-index] Search index unavailable:',String(error));
    return null;
  }
}
function targetId(target){
  const id=String(target?.dataset_id||target?.target_id||target?.connection_alias||'');
  return SOURCE.test(id)?id:null;
}
// Exact ordinary content term only. Boolean expressions, quoted phrases,
// browsing, excluded terms and UID lookups keep the existing SQL semantics.
// Scope/DB identity is checked again on the response and SQL applies its
// original content/date/site/publication/authorization predicates.
export async function withIndexedCandidates(body,target){
  if(body?.kind!=='query'||body.operation!=='select'||body.schema!=='silver'||
     typeof body.table!=='string'||!body.table.endsWith('_galaxy'))return body;
  const scopeId=body.table.slice(0,-'_galaxy'.length);
  const hint=body.indexHint;
  const q=String(hint?.query||'').trim();
  const dbId=targetId(target);
  if(!SCOPE.test(scopeId)||hint?.scopeId!==scopeId||!dbId||
     q.length<2||q.length>100||/[\s\u3000|"“”!]/u.test(q))return body;
  const result=await requestIndex('/v1/search','POST',{
    scopeId,dbId,entityType:'galaxy',query:q
  });
  if(result?.complete!==true||!Array.isArray(result.hits)||
     result.hits.length>200)return body;
  const ids=[];
  for(const hit of result.hits){
    if(hit?.scopeId!==scopeId||hit?.dbId!==dbId||
       hit.entityType!=='galaxy'||!UID.test(hit.uid))return body;
    ids.push(hit.uid);
  }
  return {...body,filters:[...(Array.isArray(body.filters)?body.filters:[]),
    {column:'uid',operator:'in',value:[...new Set(ids)]}]};
}
// A trusted Gateway writes only to the private index Worker. An index failure
// never changes or rolls back a committed Galaxy write; index completeness
// must be managed separately by the backfill/cutover procedure.
export async function writeSearchIndexDocuments(documents){
  if(!Array.isArray(documents)||!documents.length)return false;
  const checked=documents.filter(d=>SCOPE.test(d?.scopeId)&&
    SOURCE.test(d?.dbId)&&UID.test(d?.uid)&&d.entityType==='galaxy'&&
    ['append','upsert','remove'].includes(d.operation)&&
    (d.operation==='remove'||typeof d.content==='string'));
  if(checked.length!==documents.length)return false;
  const r=await requestIndex('/v1/documents','POST',{documents:checked});
  return r?.accepted===true;
}
export function searchIndexDatabaseId(target){return targetId(target);}
