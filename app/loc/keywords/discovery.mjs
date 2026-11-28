import {content_filter} from './content-filter.mjs';
import {keywordDiscoveryText,isKeywordDiscoveryStopWord,isKeywordDiscoveryWord,
  normalizeKeywordDiscoveryToken} from './discovery-filter.mjs';
import {compileKeywordLiteralMatcher} from './literal-matcher.mjs';

// Discovery uses its own lexical filter. The shared content projection remains
// unchanged for Item literal matching and NOR/AND/TO/NAME rule parsing.
export const readableKeywordContent=content_filter;
const HAN=/^\p{Script=Han}+$/u;
const normalize=normalizeKeywordDiscoveryToken;

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
    const key=isKeywordDiscoveryWord(normalized)&&!existing.has(normalized)
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
        if(!isHan||isKeywordDiscoveryStopWord(token)){
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
