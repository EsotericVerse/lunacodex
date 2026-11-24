import {content_filter,keywordScanText} from './content-filter.mjs';
import {compileKeywordLiteralMatcher} from './literal-matcher.mjs';

// Discovery only observes literal text. It never ranks a word by presumed
// meaning, language, length, frequency threshold or publication period.
// Structural markup is removed by the shared scan projection.
export const readableKeywordContent=content_filter;
const HAN=/^\p{Script=Han}+$/u;
const VISIBLE=/[\p{L}\p{N}\p{P}\p{S}]/u;
const normalize=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase();

function admissibleNormalized(value){
  // The existing Pattern title is at most 256 characters. This is a storage
  // contract, not a statistical cutoff; punctuation is valid literal text.
  return value.length>0&&value.length<=256&&VISIBLE.test(value);
}

export function existingKeywordSet(rows=[]){
  const found=new Set();
  for(const row of rows){
    if(!['item','pattern'].includes(row?.type))continue;
    const name=normalize(row.name);
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
      const body=keywordScanText(row);
      if(!body.trim())continue;
      withContent++;
      const seen=new Set();
      let prev=null,prev2=null;
      for(const piece of segmenter.segment(body)){
        const token=String(piece.segment||'').trim();
        if(!token)continue;
        const isHan=HAN.test(token);
        // A question mark, other punctuation or symbol is valid literal
        // evidence, even when Intl.Segmenter reports isWordLike=false.
        if(piece.isWordLike||VISIBLE.test(token)){
          add(token,seen,body,piece.index,token.length);
          if(prev&&prev.end===piece.index&&prev.han&&isHan){
            const pair=prev.token+token;
            add(pair,seen,body,prev.start,pair.length);
            if(prev2&&prev2.han&&prev2.end===prev.start){
              const triple=prev2.token+pair;
              add(triple,seen,body,prev2.start,triple.length);
            }
          }
          prev2=prev;
          prev={token,start:piece.index,
            end:piece.index+piece.segment.length,han:isHan};
        }else{
          prev=null;prev2=null;
        }
      }
    }
    return {read,withContent,limited:false};
  }
  function finish(){
    // Counts are observed facts, not preference weights. All candidates are
    // returned; the UI paginates without dropping long-tail or rare terms.
    const candidates=[...totals.values()]
      .sort((a,b)=>b.documents-a.documents||
        b.occurrences-a.occurrences||a.word.localeCompare(b.word))
      .map(term=>({...term,language:HAN.test(term.word)?'zh':'other'}));
    return {read,withContent,limited:false,existingCount:existing.size,
      candidates};
  }
  return {consume,finish};
}
