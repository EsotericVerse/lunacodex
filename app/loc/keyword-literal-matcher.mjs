// Shared literal dictionary for Keyword discovery and incremental reanalysis.
// This is a candidate filter, never a replacement for Item rule semantics.
// Only verified plain-grapheme text uses the compiled Aho–Corasick matcher;
// compound Unicode graphemes fall back to the original substring semantics.
import AhoCorasick from 'modern-ahocorasick';

const COMPLEX_GRAPHEME=/[\p{M}\u200c\u200d\u1100-\u11ff\u{1f1e6}-\u{1f1ff}\u{1f3fb}-\u{1f3ff}]/u;

export function compileKeywordLiteralMatcher(words=[]){
  const literals=[...new Set(words.filter(word=>typeof word==='string'&&word.length))];
  const matcher=literals.length?new AhoCorasick(literals):null;
  const complexDictionary=literals.some(word=>COMPLEX_GRAPHEME.test(word));
  const needsFallback=text=>complexDictionary||COMPLEX_GRAPHEME.test(text);
  return {
    contains(text){
      if(!matcher)return false;
      return needsFallback(text)
        ?literals.some(word=>text.includes(word))
        :matcher.match(text);
    },
    matched(text){
      if(!matcher)return new Set();
      if(needsFallback(text))return new Set(literals.filter(word=>text.includes(word)));
      const counts=matcher.countByPattern(text);
      const found=new Set();
      for(let index=0;index<counts.length;index++)
        if(counts[index]>0)found.add(literals[index]);
      return found;
    }
  };
}
