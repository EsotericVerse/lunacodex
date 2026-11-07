import {parseRuneKeywordRuleSentence} from './model/rune-keyword-rules.mjs';

// A Keyword Item is a GROUP of literal words (including its own title).
// Each word gets its OWN count/UID set from matched text, never Item.total.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const normalize=value=>String(value??'').normalize('NFKC').trim();
const identity=value=>normalize(value).toLocaleLowerCase('zh-Hant');

export function buildKeywordSearchPatterns(scopeId,items=[],matchedUids=[]){
  if(!SCOPE.test(String(scopeId||'')))throw new Error('Invalid search-pattern Scope');
  if(!Array.isArray(items)||!Array.isArray(matchedUids))
    throw new TypeError('Invalid Keyword Items or word matches');
  // The library supplies the complete set of words, even those with zero hits.
  // Expressions such as TO/AND/NAME/NOR are analysis instructions, not words.
  const words=new Map();
  for(const item of items){
    const literals=[item.item_name,...(Array.isArray(item.keywords)?item.keywords:[])
      .filter(value=>typeof value==='string'&&
        !parseRuneKeywordRuleSentence(value).rules.length)];
    for(const value of literals){
      const word=normalize(value),key=identity(word);
      if(word&&word.length<=256&&!words.has(key))words.set(key,word);
    }
  }
  const matches=new Map();
  for(const match of matchedUids){
    const key=identity(match?.pattern);
    const rawUids=match?.uid_list;
    if(!words.has(key))throw new Error('Analysis returned an unknown Keyword word');
    if(!Array.isArray(rawUids))throw new TypeError('Keyword UID matches must be arrays');
    const uids=[...rawUids];
    if(match.count!==uids.length)throw new Error('Word-level count must equal matched article count');
    if(uids.some(uid=>typeof uid!=='string'||!UID.test(uid)))
      throw new Error('Invalid word-level article UID');
    matches.set(key,new Set([...(matches.get(key)||[]),...uids]));
  }
  return [...words].map(([key,word])=>{
    const uid_list=[...(matches.get(key)||[])].sort();
    return {scopeid:scopeId,pattern:word,count:uid_list.length,uid_list};
  }).sort((a,b)=>a.pattern.localeCompare(b.pattern));
}
