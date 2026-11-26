import {compileKeywordLiteralMatcher} from '../keywords/literal-matcher.mjs';
import {keywordScanText} from '../keywords/content-filter.mjs';
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';

const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim();
export function createImportKeywordReview(rows=[],{minChars=0}={}){
  const terms=new Set();
  for(const row of rows){
    const values=row?.type==='pattern'?[row.title??row.name]:
      row?.type==='item'&&Array.isArray(row.patterns)
        ?row.patterns.map(pattern=>pattern?.title??pattern?.name):[];
    for(const value of values){
      if(typeof value!=='string'||parseRuneKeywordRuleSentence(value).rules.length)continue;
      const word=normalize(value);
      if(word)terms.add(word);
    }
  }
  const matcher=compileKeywordLiteralMatcher([...terms]);
  const totals=new Map();
  let scanned=0,matched=0;
  return {
    consume(articles=[]){
      for(const row of articles){
        if(row.keyword===false)continue;
        const text=keywordScanText(row);
        if(Array.from(text.replace(/\s/gu,'')).length<=minChars)continue;
        scanned++;
        const hits=matcher.matched(normalize(text));
        if(hits.size)matched++;
        for(const word of hits)totals.set(word,(totals.get(word)||0)+1);
      }
    },
    finish(){
      return {scanned,matched,termCount:totals.size,vocabulary:terms.size,
        top:[...totals].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5)};
    }
  };
}
