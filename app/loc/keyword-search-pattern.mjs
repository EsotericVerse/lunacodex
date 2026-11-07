import {parseRuneKeywordRuleSentence} from './model/rune-keyword-rules.mjs';

// Reuse the completed Class's Item totals/UID sets. No second article scan.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const normalize=value=>String(value??'').normalize('NFKC').trim();
const identity=value=>normalize(value).toLocaleLowerCase('zh-Hant');

export function buildKeywordSearchPatterns(scopeId,items=[]){
  if(!SCOPE.test(String(scopeId||'')))throw new Error('Invalid search-pattern Scope');
  if(!Array.isArray(items))throw new TypeError('Keyword Items must be an array');
  const patterns=new Map();
  for(const item of items){
    const stats=item?.uid_lists;
    const compact=stats&&typeof stats==='object'&&!Array.isArray(stats)&&
      Array.isArray(stats.uidlists);
    const hits=compact?stats.uidlists:Array.isArray(stats)?stats:[];
    const rawUids=compact?hits:hits.map(hit=>hit?.uid);
    if(rawUids.some(uid=>typeof uid!=='string'||!UID.test(uid)))
      throw new Error('Keyword Item UID list is invalid');
    const uids=[...new Set(rawUids)].sort();
    const count=compact?Number(stats.total):hits.reduce((sum,hit)=>
      sum+Number(hit?.times),0);
    if(!Number.isSafeInteger(count)||count<0)
      throw new Error('Keyword Item count is invalid');
    const words=Array.isArray(item?.keywords)?item.keywords:[];
    const terms=[item?.item_name,...words.filter(word=>
      typeof word==='string'&&!parseRuneKeywordRuleSentence(word).rules.length)];
    const itemTerms=new Set();
    for(const term of terms){
      const word=normalize(term),key=identity(word);
      if(!word||word.length>256||itemTerms.has(key))continue;
      itemTerms.add(key);
      let entry=patterns.get(key);
      if(!entry){entry={scopeid:scopeId,pattern:word,count:0,uids:new Set()};
        patterns.set(key,entry);}
      if(!Number.isSafeInteger(entry.count+count))
        throw new Error('Search-pattern count overflow');
      // Alias/title searches reuse the Item's analyzed count; they are not
      // independently measured substring frequencies.
      entry.count+=count;
      for(const uid of uids)entry.uids.add(uid);
    }
  }
  return [...patterns.values()].map(({uids,...row})=>({
    ...row,uid_list:[...uids].sort()
  })).sort((a,b)=>a.pattern.localeCompare(b.pattern));
}
