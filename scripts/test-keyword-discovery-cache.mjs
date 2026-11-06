import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app/loc/keyword-discovery-cache.mjs',import.meta.url),'utf8')
  .replace(/^import .*$/gm,'').replaceAll('export function ','function ')
  .replaceAll('export async function ','async function ');
const {encodeKeywordSuggestionCache,decodeKeywordSuggestionCache}=runInNewContext(
  source+';({encodeKeywordSuggestionCache,decodeKeywordSuggestionCache})');

test('Cache is a plain text[] containing only unique candidate words',()=>{
  const stored=encodeKeywordSuggestionCache({read:31,withContent:30,
    dense:{start:'2026-06',end:'2026-09',documents:20},
    candidates:[{word:'都市牢籠',documents:12,sample:'原文'},
      {word:'星辰共鳴',documents:7},{word:'都市牢籠',documents:6}]
  });
  assert.ok(Array.isArray(stored));
  assert.deepEqual([...stored],['都市牢籠','星辰共鳴']);
  assert.ok(stored.every(word=>typeof word==='string'));
  const loaded=decodeKeywordSuggestionCache(stored);
  assert.equal(loaded.cachedOnly,true);
  assert.deepEqual(loaded.candidates.map(row=>row.word),['都市牢籠','星辰共鳴']);
  assert.equal(loaded.candidates[0].documents,undefined);
});

test('NULL cache means no prior scan while empty text[] is a valid scan',()=>{
  assert.equal(decodeKeywordSuggestionCache(null),null);
  const cached=decodeKeywordSuggestionCache(encodeKeywordSuggestionCache({candidates:[]}));
  assert.equal(cached.cachedOnly,true);
  assert.equal(cached.candidates.length,0);
});

test('Cache never writes counts, examples, or more than 120 terms',()=>{
  const value=encodeKeywordSuggestionCache({
    candidates:Array.from({length:200},(_,i)=>({
      word:'候選'+i,documents:5,occurrences:10,sample:'一段隱藏的內文'
    }))
  });
  assert.equal(value.length,120);
  assert.ok(value.every(word=>typeof word==='string'&&!word.includes('隱藏')));
});

test('Serialized HTML fragments never enter or survive TEXT[] cache',()=>{
  const stored=encodeKeywordSuggestionCache({
    candidates:[
      {word:'div'},{word:'</div>'},{word:'<div'},
      {word:'span'},{word:'class'},{word:'星辰共鳴'}
    ]
  });
  assert.deepEqual([...stored],['星辰共鳴']);
  const loaded=decodeKeywordSuggestionCache(['<div','</div>','div','都市牢籠']);
  assert.deepEqual(loaded.candidates.map(row=>row.word),['都市牢籠']);
});

test('unified Scope can persist keyword suggestions without an undefined cache constant',async()=>{
  const writes=[];
  const writeKeywordSuggestionCache=runInNewContext(source+';writeKeywordSuggestionCache',{
    isUnifiedAnchorScope:scope=>scope==='lo3rwang',
    dbAuthRelation:table=>({
      update(value){writes.push({table,value});return this},
      eq(column,value){writes.push({column,value});return this},
      async select(){return {data:[{id:'lo3rwang'}],error:null}}
    })
  });
  const result=await writeKeywordSuggestionCache('lo3rwang','silver.lo3rwang',{
    candidates:[{word:'星辰共鳴'}]
  });
  assert.deepEqual(result.candidates.map(row=>row.word),['星辰共鳴']);
  assert.equal(writes[0].table,'silver.lo3rwang');
  assert.deepEqual([...writes[0].value.keyword_suggestions],['星辰共鳴']);
  assert.equal(await writeKeywordSuggestionCache('unsupported','silver.unsupported',{
    candidates:[{word:'隱藏'}]
  }),null);
  assert.equal(writes.length,2);
  await assert.rejects(writeKeywordSuggestionCache('lo3rwang','silver.lrunes',{
    candidates:[]}),/Scope 不一致/);
});
