// Shared literal dictionary for Keyword discovery and incremental reanalysis.
// This is a candidate filter, never a replacement for Item rule semantics.
// Only verified plain-grapheme text uses the compiled Aho–Corasick matcher;
// compound Unicode graphemes fall back to the original substring semantics.
import AhoCorasick from 'modern-ahocorasick';

const COMPLEX_GRAPHEME=/[\p{M}\u200c\u200d\u1100-\u11ff\u{1f1e6}-\u{1f1ff}\u{1f3fb}-\u{1f3ff}]/u;

export function compileKeywordLiteralMatcher(words=[]){
  const literals=[...new Set(words.filter(word=>typeof word==='string'&&word.length))];
  const matcher=literals.length?new AhoCorasick(literals):null;
  // Only the input text needs to be checked: a complex literal cannot match
  // plain text, so one unusual Keyword should not force every article onto
  // the slower substring fallback.
  const needsFallback=text=>COMPLEX_GRAPHEME.test(text)||text.includes('\r\n');
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
      const found=new Set();
      for(const hit of matcher.iterate(text))found.add(literals[hit.patternIndex]);
      return found;
    },
    // Vocabulary-level Pattern counts use the same compiled Aho matcher
    // as the existing literal classifier. Return positive term counts
    // without article UIDs or a second searchable index.
    countMatches(text){
      if(!matcher)return [];
      // A 631-Pattern Class previously allocated a 631-element dense count
      // vector for EVERY article. Most articles mention only a handful of
      // Patterns, so stream matches into a sparse per-article map instead.
      // Keep the original literal-substring fallback for complex graphemes.
      const counts=new Map();
      if(needsFallback(text)){
        for(let index=0;index<literals.length;index++){
          const word=literals[index];
          let n=0,from=0,position;
          while((position=text.indexOf(word,from))!==-1){
            n++;from=position+word.length;
          }
          if(n)counts.set(index,n);
        }
      }else{
        for(const hit of matcher.iterate(text)){
          const index=hit.patternIndex;
          counts.set(index,(counts.get(index)||0)+1);
        }
      }
      return [...counts].sort((a,b)=>a[0]-b[0])
        .map(([index,total])=>[literals[index],total]);
    }
  };
}
