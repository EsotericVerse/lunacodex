import assert from 'node:assert/strict';
import test from 'node:test';
import {compileKeywordLiteralMatcher} from '../app/loc/keyword-literal-matcher.mjs';

test('Aho-Corasick dictionary agrees with literal includes, including overlaps',()=>{
  const words=['城市','城市記憶','night','night','dark jazz','c++','a.b','量子糾纏'];
  const matcher=compileKeywordLiteralMatcher(words);
  for(const text of [
    '城市記憶與量子糾纏','dark jazz 和 C++','nightfall','a.b',
    '什麼都沒有','都市生活','a-b','城市城市記憶'
  ]){
    assert.equal(matcher.contains(text),words.some(word=>text.includes(word)));
    assert.deepEqual([...matcher.matched(text)].sort(),
      [...new Set(words.filter(word=>text.includes(word)))].sort());
  }
});

test('Unicode clusters preserve legacy substring semantics rather than changing keyword coverage',()=>{
  const words=['e','👩','🇹','月','城','s'];
  const matcher=compileKeywordLiteralMatcher(words);
  for(const text of ['e\u0301','👩‍💻','🇹🇼','🌙月光','城市','𝘴']){
    assert.equal(matcher.contains(text),words.some(word=>text.includes(word)));
    assert.deepEqual([...matcher.matched(text)].sort(),
      words.filter(word=>text.includes(word)).sort());
  }
});

test('large compiled literal dictionary preserves overlaps without repeated string scans',()=>{
  const words=Array.from({length:420},(_,i)=>'特徵詞'+i);
  const matcher=compileKeywordLiteralMatcher(words);
  const text='作品：特徵詞12、特徵詞125、特徵詞312 與城市記憶';
  assert.equal(matcher.contains(text),true);
  assert.deepEqual([...matcher.matched(text)].sort(),
    words.filter(word=>text.includes(word)).sort());
  assert.equal(compileKeywordLiteralMatcher([]).contains(text),false);
  assert.deepEqual([...compileKeywordLiteralMatcher([]).matched(text)],[]);
});
