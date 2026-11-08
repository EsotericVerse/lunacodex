import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GALAXY_ABLE_KEYS,galaxyAble,prepareGalaxyInsertRows} from '../app/loc/galaxy-able.mjs';
import {extractSearchContext} from '../app/loc/search-extract.mjs';

test('Galaxy stores eight independent feature flags, even when an article is hidden',()=>{
  assert.deepEqual(GALAXY_ABLE_KEYS,['statics','culture','search','trace','list','keyword','extract','others']);
  const features=galaxyAble({searchable:false,statistics_able:false,
    able:{statics:true,culture:false,search:true,trace:false,list:false,keywords:true,game:true,extract:true}});
  assert.equal(features.statics,true);
  assert.equal(features.list,false);
  assert.equal(features.search,true);
  assert.equal(features.extract,true);
  const saved=prepareGalaxyInsertRows('silver.lo3rwang_galaxy',[{uid:'0123aBCD'}])[0];
  assert.equal(saved.others,true);
  assert.equal(Object.hasOwn(saved,'able'),false);
});
test('search excerpt shows exactly the hit with approximately ten surrounding characters',()=>{
  const text='天涯海角的深處星光照耀我們的混沌之月漸漸走向黎明朝陽';
  const snippet=extractSearchContext(text,'混沌',10);
  assert.match(snippet,/混沌/);
  assert.ok(Array.from(snippet.split('混沌')[0].replace(/^…/,'')).length<=10);
  assert.ok(Array.from(snippet.split('混沌')[1].replace(/…$/,'')).length<=10);
  assert.equal(extractSearchContext(text,'不匹配詞',10),'');
  assert.match(extractSearchContext('<p>歌曲<b>混沌</b>之月</p>','混沌'),/混沌/);
  assert.doesNotMatch(extractSearchContext('<p>歌曲<b>混沌</b>之月</p>','混沌'),/<[a-z]/i);
});
test('search is primary, excerpt is optional and never loads in regular browse',()=>{
  const ui=readFileSync(new URL('../app/modular/features/Search.jsx',import.meta.url),'utf8');
  const query=readFileSync(new URL('../app/loc/galaxy-query.js',import.meta.url),'utf8');
  assert.match(query,/column:'search'/);
  assert.doesNotMatch(ui,/media_link,able/);
  assert.match(ui,/scopeId==='local'\?'uid,content,able':'uid,content,search,extract'/);
  assert.match(ui,/galaxyAble\(article\)\.search===false\|\|galaxyAble\(article\)\.extract===false/);
  assert.match(ui,/if\(q&&!options\.browse&&!options\.placeOnly&&!options\.mediaOnly/);
  assert.match(ui,/extractSearchContext\(article\.content,query,10\)/);
  assert.match(ui,/highlightSearchText\(row\.snippet,matchedQueryRef\.current\)/);
  assert.match(ui,/row\.list===false\?'（使用者隱藏）'/);
});

test('unprovisioned Local Scope does not retain packed SQLite able writes',()=>{
  const row=prepareGalaxyInsertRows('silver.local_galaxy',[{uid:'ABcD1234',list:false}])[0];
  assert.equal(row.list,false);
  assert.equal(Object.hasOwn(row,'able'),false);
  assert.equal(row.keyword,true);
  assert.equal(row.others,true);
});
