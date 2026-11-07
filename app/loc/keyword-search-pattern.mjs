import {parseRuneKeywordRuleSentence} from './model/rune-keyword-rules.mjs';

// Individual matched words, never Item totals, are the index grain.
// This receives the terms recorded by the existing reanalysis classifier.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const normalize=value=>String(value??'').normalize('NFKC').trim();
const identity=value=>normalize(value).toLocaleLowerCase('zh-Hant');

export function buildKeywordSearchPatterns(scopeId,items=[],termMatches=[]){
  if(!SCOPE.test(String(scopeId||'')))throw new Error('Invalid search-pattern Scope');
  if(!Array.isArray(items)||!Array.isArray(termMatches))
    throw new TypeError('Keyword Item catalogue and term matches must be arrays');
  const allowed=new Map();
  for(const item of items){
    for(const term of [item?.item_name,...(Array.isArray(item?.keywords)?item.keywords:[])]){
      if(typeof term!=='string'||parseRuneKeywordRuleSentence(term).rules.length)continue;
      const word=normalize(term),key=identity(word);
      if(!word)continue;
      if(word.length>256)throw new Error('Search-pattern word too long');
      if(!allowed.has(key))allowed.set(key,word);
    }
  }
  const recorded=new Map();
  for(const match of termMatches){
    const key=identity(match?.pattern),word=allowed.get(key);
    const ids=match?.uid_list;
    if(!word||recorded.has(key)||!Array.isArray(ids)||ids.some(uid=>
      typeof uid!=='string'||!UID.test(uid))||new Set(ids).size!==ids.length||
      !Number.isSafeInteger(match.count)||match.count!==ids.length)
      throw new Error('Invalid per-word UID match count');
    recorded.set(key,{scopeid:scopeId,pattern:word,count:ids.length,
      uid_list:[...ids].sort()});
  }
  // Preserve zero-hit searchable terms so the first reanalysis populates
  // autocomplete without inventing any article identities.
  return [...allowed].map(([key,word])=>
    recorded.get(key)||{scopeid:scopeId,pattern:word,count:0,uid_list:[]}
  ).sort((a,b)=>a.pattern.localeCompare(b.pattern));
}
