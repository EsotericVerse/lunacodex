import {parseSearchQuery} from './query.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const normalize=value=>String(value??'').normalize('NFKC')
  .trim().toLocaleLowerCase('zh-Hant').replace(/[\s\u3000]+/g,'');
const identity=(scopeId,uid)=>String(scopeId||'')+'\u0000'+String(uid||'');

export function searchPatternSuggestions(patterns=[],raw='',limit=36){
  const query=normalize(raw);
  if(!query||!Array.isArray(patterns)||!Number.isSafeInteger(limit)||limit<1)return [];
  const words=new Map();
  for(const row of patterns){
    const title=String(row?.title||'').trim(),key=normalize(title);
    if(!title||!key||!key.includes(query))continue;
    if(!words.has(key))words.set(key,title);
  }
  return [...words.entries()].sort(([left],[right])=>
    Number(!left.startsWith(query))-Number(!right.startsWith(query))||left.localeCompare(right))
    .slice(0,limit).map(([,title])=>title);
}

function matchedPatterns(patterns,rawQuery){
  const terms=parseSearchQuery(rawQuery).terms.map(normalize).filter(Boolean);
  if(!terms.length||!Array.isArray(patterns))return [];
  const matched=[];
  patterns.forEach((row,index)=>{
    const title=String(row?.title||'').trim(),pattern=normalize(title);
    const featuredUid=String(row?.featuredUid||'').trim();
    if(!title||!pattern||!UID.test(featuredUid))return;
    const term=terms.find(value=>value===pattern||pattern.length>1&&value.includes(pattern));
    if(term)matched.push({row,title,pattern,featuredUid,index,exact:term===pattern});
  });
  return matched.sort((left,right)=>Number(right.exact)-Number(left.exact)||
    right.pattern.length-left.pattern.length||left.pattern.localeCompare(right.pattern)||
    String(left.row.scopeId||'').localeCompare(String(right.row.scopeId||''))||left.index-right.index);
}

export function applyFeaturedSearchResults(rows=[],patterns=[],featuredArticles=[],rawQuery='',toResult){
  const results=Array.isArray(rows)?rows.slice():[];
  if(typeof toResult!=='function')return results;
  const articleMap=new Map((Array.isArray(featuredArticles)?featuredArticles:[])
    .filter(row=>UID.test(String(row?.uid||''))&&String(row?.scope_id||''))
    .map(row=>[identity(row.scope_id,row.uid),row]));
  const byIdentity=new Map();
  results.forEach((row,index)=>{if(row?.resourceType==='galaxy'&&row.resourceId)byIdentity.set(identity(row.scopeId,row.resourceId),index);});
  const pinned=new Set();
  for(const match of matchedPatterns(patterns,rawQuery)){
    const scopeId=String(match.row.scopeId||'').trim(),key=identity(scopeId,match.featuredUid);
    const article=articleMap.get(key);
    if(!scopeId||!article||pinned.has(key))continue;
    pinned.add(key);
    const existingIndex=byIdentity.get(key);
    if(existingIndex!==undefined){
      results[existingIndex]={...results[existingIndex],featured:true,featuredPatternTitle:match.title};
      continue;
    }
    const result=toResult({...article,scope_id:scopeId},String(article.site||scopeId),scopeId);
    if(!result)continue;
    results.push({...result,featured:true,featuredPatternTitle:match.title});
    byIdentity.set(key,results.length-1);
  }
  return results.sort((left,right)=>Number(Boolean(right.featured))-Number(Boolean(left.featured)));
}
