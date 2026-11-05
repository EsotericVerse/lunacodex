'use client';

import {dbPublicClient} from '../../../loc/db-client.mjs';
import {spatialReferenceLikePattern,spatialReferenceCandidates,spatialReferenceLabelVariants} from './trace-spatial-references.mjs';

const referenceScopes=['lo3rwang','lrunes'];

function referenceRows(scope,rows){
  return (rows||[]).map(row=>({
    uid:row.uid,scope_id:scope,title:row.title,
    address:'',floor_label:'',
    longitude:row.attr?.longitude??null,
    latitude:row.attr?.latitude??null
  }));
}

export async function readSharedSpatialReferences(term){
  const patterns=spatialReferenceLabelVariants(term)
    .map(spatialReferenceLikePattern).filter(Boolean);
  if(!patterns.length)return [];
  const requests=referenceScopes.flatMap(scope=>patterns.map(async pattern=>{
    const result=await dbPublicClient.schema('silver').from(scope+'_anchor')
      .select('uid,title,attr').eq('type','point')
      .ilike('title',pattern).order('title',{ascending:true}).limit(8);
    if(result.error)throw Error('空間定錨參考查詢失敗：'+result.error.message);
    return referenceRows(scope,result.data);
  }));
  return spatialReferenceCandidates(await Promise.all(requests));
}

export async function readSharedSpatialReferencesByNames(names=[]){
  const unique=[...new Set((Array.isArray(names)?names:[])
    .map(value=>String(value||'').trim()).filter(Boolean))];
  if(!unique.length)return [];
  if(unique.length>20)throw Error('同批地名超過 20 個，請分批查詢。');
  const spellings=[...new Set(unique.flatMap(spatialReferenceLabelVariants))];
  const requests=referenceScopes.map(async scope=>{
    const result=await dbPublicClient.schema('silver').from(scope+'_anchor')
      .select('uid,title,attr').eq('type','point')
      .in('title',spellings).order('title',{ascending:true}).limit(201);
    if(result.error)throw Error('已有定錨點批次查詢失敗：'+result.error.message);
    if((result.data||[]).length>200)throw Error('同名地點候選過多，請改用逐筆地址搜尋。');
    return referenceRows(scope,result.data);
  });
  return spatialReferenceCandidates(await Promise.all(requests),200);
}
