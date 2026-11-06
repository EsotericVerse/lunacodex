'use client';

import {dbAuthClient,dbAuthRelation} from './db-client.mjs';
import {isUnifiedAnchorScope} from './unified-anchor-compat.mjs';

const CACHE_COLUMN='keyword_suggestions';
const MAX_CACHE_ROWS=120;
const REJECT_STRUCTURE=new Set('div span html script style class classname svg path section article header footer li ul ol table tr td th iframe href src meta link css js json jsonb'.split(/\s+/u));
export function isKeywordSuggestionText(value){
  const text=String(value||'').trim();
  return Boolean(text)&&!/[<>\[\]{}]/u.test(text)
    &&!REJECT_STRUCTURE.has(text.toLowerCase());
}

// Exactly one text[] column; never store counts, excerpts or summaries
// alongside user-visible candidate keyword strings.
export function encodeKeywordSuggestionCache(result){
  const items=Array.isArray(result?.candidates)?result.candidates:[];
  const seen=new Set(),words=[];
  for(const item of items){
    const word=String(item?.word??item??'').normalize('NFKC').trim();
    if(!isKeywordSuggestionText(word)||seen.has(word.toLocaleLowerCase()))continue;
    seen.add(word.toLocaleLowerCase());
    words.push(word);
    if(words.length>=MAX_CACHE_ROWS)break;
  }
  return words;
}
export function decodeKeywordSuggestionCache(value){
  if(!Array.isArray(value))return null;
  return {cachedOnly:true,candidates:value.filter(word=>typeof word==='string'&&isKeywordSuggestionText(word))
    .slice(0,MAX_CACHE_ROWS).map(word=>({word:word.trim()}))};
}
export async function readKeywordSuggestionCache(scopeId){
  if(!isUnifiedAnchorScope(scopeId))return null;
  const {data,error}=await dbAuthClient.schema('silver')
    .anchor(scopeId,'item',{op:'suggestions'});
  if(error)throw new Error(error.message||'無法讀取關鍵詞暫存');
  return decodeKeywordSuggestionCache(data);
}
export async function writeKeywordSuggestionCache(scopeId,table,result){
  if(!isUnifiedAnchorScope(scopeId))return null;
  if(table!=='silver.'+scopeId)throw new Error('關鍵詞暫存 Scope 不一致');
  const payload=encodeKeywordSuggestionCache(result);
  const {data,error}=await dbAuthRelation(table)
    .update({[CACHE_COLUMN]:payload})
    .eq('id',scopeId).select('id');
  if(error||data?.length!==1)
    throw new Error(error?.message||'建議結果未能暫存');
  return decodeKeywordSuggestionCache(payload);
}
