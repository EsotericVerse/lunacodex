import {queryGalaxyFeature} from '../actions/galaxy/queries.mjs';
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
  const payload=await queryGalaxyFeature(body);
  if(!payload||!payload.data||payload.query?.requestedBy!==feature)
    throw Error('Invalid Galaxy feature transaction response');
  return payload;
}
