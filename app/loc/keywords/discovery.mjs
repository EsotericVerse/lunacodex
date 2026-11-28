import {content_filter} from './content-filter.mjs';
import {keywordDiscoveryText} from './discovery-text-filter.mjs';
import {compileKeywordLiteralMatcher} from './literal-matcher.mjs';

// The shared content projection remains unchanged for Item rule parsing.
// Only the suggestion scanner applies punctuation and stop-word filtering.
export const readableKeywordContent=content_filter;
const HAN=/^\p{Script=Han}+$/u;
const normalize=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase();

const DISCOVERY_STOP_WORDS=new Set([
  // Pronouns and references
  '我','你','他','她','它','您','咱','我們','你們','他們','她們','它們',
  '自己','大家','各位','本人','對方','別人','有人','人們','這','那','這個','那個',
  '這些','那些','其','其中','此','彼','某','各','每',
  // Function words and common grammatical tokens
  '的','了','著','過','是','有','在','和','與','或','及','而','但','並','也','都',
  '很','更','最','太','才','就','又','還','已','仍','曾','將','把','被','讓','給',
  '對','於','從','到','向','往','為','以','之','所','則','而且','以及','或者',
  '如果','因為','所以','因此','但是','不過','同時','另外',
  // Editorial and article scaffolding
  '作者','本文','原文','文章','內容','標題','本篇','這篇','該篇','來源','出處',
  '來自','來自於','例如','等等','如下','上述','其他','目前','現在','相關',
  '進行','使用','可以','需要','可能','如何','什麼','怎麼','為什麼','就是',
  '不是','沒有','一個','一些','很多','非常'
]);

function admissibleNormalized(value){
  const length=Array.from(value).length;
  return length>=2&&length<=4&&HAN.test(value)&&!DISCOVERY_STOP_WORDS.has(value);
}

export function existingKeywordSet(rows=[]){
  const found=new Set();
  for(const row of rows){
    if(!['item','pattern'].includes(row?.type))continue;
    const name=row.type==='pattern'?normalize(row.name):'';
    if(name)found.add(name);
    for(const term of row.type==='item'&&Array.isArray(row.lists)?row.lists:[]){
      const key=normalize(term);
      if(key)found.add(key);
    }
  }
  return found;
}

// Match known literals inside new candidates without discarding longer
// unregistered phrases. Compile once; only the visible suggestion page is annotated.
export function createDiscoveryKnownMatcher(rows=[]){
  const known=existingKeywordSet(rows);
  const matcher=compileKeywordLiteralMatcher([...known]);
  return word=>[...matcher.matched(normalize(word))]
    .filter(term=>term!==normalize(word))
    .sort((a,b)=>b.length-a.length||a.localeCompare(b)).slice(0,5);
}

export function createNewKeywordDiscovery(rows=[]){
  const existing=existingKeywordSet(rows);
  const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
  const totals=new Map();
  const tokenCache=new Map();
  const TOKEN_CACHE_LIMIT=16384;
  let read=0,withContent=0;
  function normalizedCandidate(term){
    if(tokenCache.has(term))return tokenCache.get(term);
    const normalized=normalize(term);
    const key=admissibleNormalized(normalized)&&!existing.has(normalized)
      ?normalized:null;
    if(tokenCache.size>=TOKEN_CACHE_LIMIT)tokenCache.clear();
    tokenCache.set(term,key);
    return key;
  }
  function add(term,seen,body,position,length){
    const key=normalizedCandidate(term);
    if(key===null)return;
    let record=totals.get(key);
    if(!record){
      const sample=body.slice(Math.max(0,position-28),
        Math.min(body.length,position+length+32)).replace(/\s+/gu,' ').trim();
      record={word:key,documents:0,occurrences:0,sample};
      totals.set(key,record);
    }
    record.occurrences++;
    if(!seen.has(key)){
      seen.add(key);
      record.documents++;
    }
  }
  function consume(batch=[]){
    for(const row of batch){
      read++;
      const body=keywordDiscoveryText(row);
      if(!body)continue;
      withContent++;
      const seen=new Set();
      let previous=null;
      for(const piece of segmenter.segment(body)){
        const token=String(piece.segment||'').trim();
        if(!token)continue;
        const isHan=HAN.test(token);
        if(!isHan||DISCOVERY_STOP_WORDS.has(token)){
          previous=null;
          continue;
        }
        const chars=Array.from(token);
        if(chars.length>=2&&chars.length<=4)
          add(token,seen,body,piece.index,token.length);
        else if(chars.length>4){
          // A long Segmenter token may contain several independently useful
          // 2–4 character terms. Never emit the full long token.
          for(let size=2;size<=4;size++){
            for(let start=0;start+size<=chars.length;start++){
              const candidate=chars.slice(start,start+size).join('');
              add(candidate,seen,body,piece.index+start,candidate.length);
            }
          }
        }
        if(previous&&previous.end===piece.index){
          const combined=previous.token+token;
          const length=Array.from(combined).length;
          if(length>=2&&length<=4)
            add(combined,seen,body,previous.start,combined.length);
        }
        previous={token,start:piece.index,end:piece.index+piece.segment.length};
      }
    }
    return {read,withContent,limited:false,candidateCount:totals.size,existingCount:existing.size};
  }
  function finish(){
    // Counts are observed facts, not preference weights. All admissible
    // candidates are returned; the UI paginates without dropping rare terms.
    const candidates=[...totals.values()]
      .sort((a,b)=>b.documents-a.documents||
        b.occurrences-a.occurrences||a.word.localeCompare(b.word))
      .map(term=>({...term,language:'zh'}));
    return {read,withContent,limited:false,existingCount:existing.size,
      candidates};
  }
  return {consume,finish};
}
