// Browser-side fixed feature client: never passes SQL, table or column names.
export async function readGalaxyFeature({
  feature,scope,startDate,endDate,category,sources,excludedSources,
  placeIds,mediaUrls,text,requiredTerms,excludedTerms,
  result='count',cursor,limit,offset,sortDirection,includeTotal,orderByDate,signal
}={}){
  const body={kind:'transaction',operation:'galaxy-feature',
    feature,scope,startDate,endDate,category,sources,excludedSources,
    placeIds,mediaUrls,text,requiredTerms,excludedTerms,
    result,cursor,limit,offset,sortDirection,includeTotal,orderByDate};
  const response=await fetch('/api/loc-public-query',{
    method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
    headers:{accept:'application/json','content-type':'application/json'},
    body:JSON.stringify(body),
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):
      AbortSignal.timeout(15000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error('Galaxy '+feature+' read failed (HTTP '+response.status+')');
    error.status=response.status;throw error;
  }
  if(!payload||!payload.data||payload.transaction?.requestedBy!==feature)
    throw Error('Invalid Galaxy feature transaction response');
  return payload;
}
