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


// Compose Item statistics from the existing word index: no Galaxy text read,
// no Anchor total writes, and no mutation of a word's update_time.
// Item hit_count is the SUM of its distinct literal-word hit counts;
// document_count is the UNION of article UIDs, not that sum.
export function keywordPatternItemMetrics(items=[],storedPatterns=[],{articleUids=null}={}){
  if(articleUids!==null&&!(articleUids instanceof Set))
    throw new TypeError('Allowed article UIDs must be a Set');
  if(!Array.isArray(items)||!Array.isArray(storedPatterns))
    throw new TypeError('Keyword Item catalog and stored word rows are required');
  const byWord=new Map();
  for(const row of storedPatterns){
    const key=identity(row?.pattern);
    if(!key||byWord.has(key))continue;
    const uids=row.uid_list;
    if(!Array.isArray(uids)||uids.some(uid=>typeof uid!=='string'||!UID.test(uid))||
       new Set(uids).size!==uids.length||Number(row.count)!==uids.length)
      throw new Error('Invalid stored word UID lookup');
    byWord.set(key,row);
  }
  const missing=new Map(),allArticles=new Set();
  let totalHits=0;
  const summaries=items.map(item=>{
    const itemWords=new Map();
    const candidates=[item.item_name,...(Array.isArray(item.keywords)?item.keywords:[])
      .filter(value=>typeof value==='string'&&!parseRuneKeywordRuleSentence(value).rules.length)];
    for(const value of candidates){
      const word=normalize(value),key=identity(word);
      if(word&&word.length<=256&&!itemWords.has(key))itemWords.set(key,word);
    }
    const articles=new Set(),words=[];
    let hitCount=0;
    for(const [key,word] of itemWords){
      const stored=byWord.get(key);
      if(!stored){
        missing.set(key,word);
        words.push({pattern:word,count:0,indexed:false,ratio:0});
        continue;
      }
      const matching=articleUids===null?stored.uid_list:
        stored.uid_list.filter(uid=>articleUids.has(uid));
      const count=matching.length;
      hitCount+=count;
      for(const uid of matching){articles.add(uid);allArticles.add(uid);}
      words.push({pattern:word,count,indexed:true,ratio:0});
    }
    totalHits+=hitCount;
    return {
      uid:String(item.uid||''),
      group_uid:String(item.group_uid||''),
      name:String(item.item_name||''),
      hit_count:hitCount,document_count:articles.size,
      words:words.map(word=>({...word,
        ratio:hitCount>0&&word.indexed?100*word.count/hitCount:0}))
    };
  });
  return {
    items:summaries.map(item=>({...item,
      ratio:totalHits>0?100*item.hit_count/totalHits:0})),
    total_hits:totalHits,document_count:allArticles.size,
    missing_patterns:[...missing.values()]
  };
}

// LOC Kysely transport caps POST bodies at 1 MiB. Bound the reanalysis-only
// upload without imposing extra round trips on ordinary Search requests.
export function splitKeywordPatternBatches(patterns,maxBytes=700_000){
  if(!Array.isArray(patterns)||!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>900_000)
    throw new Error('Invalid search-pattern upload budget');
  const encoder=new TextEncoder(),batches=[];
  let batch=[],used=256;
  for(const row of patterns){
    const bytes=encoder.encode(JSON.stringify(row)).byteLength+1;
    if(bytes+256>maxBytes)throw new Error('單一關鍵詞 UID 清單超過同步上限');
    if(used+bytes>maxBytes){
      batches.push(batch);batch=[];used=256;
    }
    batch.push(row);used+=bytes;
  }
  if(batch.length||!batches.length)batches.push(batch);
  return batches;
}
