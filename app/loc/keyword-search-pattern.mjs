import {parseRuneKeywordRuleSentence} from './model/rune-keyword-rules.mjs';

// One Keyword Item contributes its existing analysis result to each literal
// alias and its title. This is NOT another content scan or a tokenizer.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const normalize=value=>String(value??'').normalize('NFKC').trim();
const identity=value=>normalize(value).toLocaleLowerCase('zh-Hant');

export function buildKeywordSearchPatterns(scopeId,items=[]){
  if(!SCOPE.test(String(scopeId||'')))throw new Error('Invalid search-pattern Scope');
  if(!Array.isArray(items))throw new TypeError('Keyword Items must be an array');
  const patterns=new Map();
  for(const item of items){
    if(item?.type!=='item')throw new Error('Only Keyword Items may populate search patterns');
    const attr=typeof item.attr==='string'?JSON.parse(item.attr):item.attr||{};
    const rawUids=attr.uidlists;
    if(!Array.isArray(rawUids)||rawUids.some(uid=>typeof uid!=='string'||!UID.test(uid)))
      throw new Error('Keyword Item UID list is invalid');
    const uids=[...new Set(rawUids)].sort();
    const count=Number(attr.total??uids.length);
    if(!Number.isSafeInteger(count)||count<0)throw new Error('Keyword Item count is invalid');
    const words=Array.isArray(attr.keyword)?attr.keyword:[];
    const terms=[item.title,...words.filter(word=>
      typeof word==='string'&&!parseRuneKeywordRuleSentence(word).rules.length)];
    const itemTerms=new Set();
    for(const term of terms){
      const word=normalize(term),key=identity(word);
      if(!word||word.length>256||itemTerms.has(key))continue;
      itemTerms.add(key);
      let entry=patterns.get(key);
      if(!entry){entry={scopeid:scopeId,pattern:word,count:0,uid_list:[]};
        entry.uids=new Set();patterns.set(key,entry);}
      if(!Number.isSafeInteger(entry.count+count))
        throw new Error('Search-pattern count overflow');
      entry.count+=count;
      for(const uid of uids)entry.uids.add(uid);
    }
  }
  return [...patterns.values()].map(({uids,...row})=>({
    ...row,uid_list:[...uids].sort()
  })).sort((a,b)=>a.pattern.localeCompare(b.pattern));
}
