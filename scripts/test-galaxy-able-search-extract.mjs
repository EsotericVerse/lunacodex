import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GALAXY_ABLE_KEYS,galaxyAble,prepareGalaxyInsertRows} from '../app/loc/galaxy-able.mjs';
import {extractSearchContext} from '../app/loc/search-extract.mjs';

test('Galaxy stores canonical eight attr booleans, even when an article is hidden',()=>{
  assert.deepEqual(GALAXY_ABLE_KEYS,['statics','culture','search','trace','list','keyword','extract','others']);
  const features=galaxyAble({searchable:false,statistics_able:false,
    able:{statics:true,culture:false,search:true,trace:false,list:false,keywords:true,game:true,extract:true}});
  assert.equal(features.statics,true);
  assert.equal(features.list,false);
  assert.equal(features.search,true);
  assert.equal(features.extract,true);
  const saved=prepareGalaxyInsertRows('silver.lo3rwang_galaxy',[{uid:'0123aBCD'}])[0];
  assert.equal(saved.attr.others,true);
  assert.equal(Object.hasOwn(saved,'others'),false);
  assert.deepEqual(saved.attr,galaxyAble(saved));
  assert.deepEqual(Object.keys(saved.attr),GALAXY_ABLE_KEYS);
  assert.equal(galaxyAble({attr:{list:false,extract:false},list:true,extract:true}).list,false);
  assert.equal(galaxyAble({attr:{list:false,extract:false},list:true,extract:true}).extract,false);
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
  assert.match(ui,/scopeId==='local'\?'uid,content,able':'uid,content,attr,search,extract'/);
  assert.match(ui,/galaxyAble\(article\)\.search===false\|\|galaxyAble\(article\)\.extract===false/);
  assert.match(ui,/if\(q&&!options\.browse&&!options\.placeOnly&&!options\.mediaOnly/);
  assert.match(ui,/extractSearchContext\(article\.content,query,10\)/);
  assert.match(ui,/highlightSearchText\(row\.snippet,matchedQueryRef\.current\)/);
  assert.match(ui,/row\.list===false\?'（使用者隱藏）'/);
});

test('device-local SQLite continues storing the archived able payload',()=>{
  const local=prepareGalaxyInsertRows('silver.local_galaxy',[{uid:'ABcD1234',list:false}])[0];
  assert.equal(local.able.list,false);
  assert.equal(Object.hasOwn(local,'list'),false);
  assert.equal(local.able.keywords,true);
  assert.equal(local.able.game,true);
});

// Historical migration stays immutable; live rules now read canonical attr.
test('Galaxy attr migration contains both live Scope tables and a non-destructive sync trigger',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261104221000_galaxy_attr_eight_flags.sql',import.meta.url),'utf8');
  for(const scope of ['lo3rwang','lrunes'])assert.match(sql,new RegExp('silver\\.'+scope+'_galaxy'));
  assert.match(sql,/CREATE OR REPLACE FUNCTION silver\\.sync_galaxy_capability_attr/);
  assert.match(sql,/NEW\\.attr := pg_catalog\\.jsonb_build_object/);
  assert.doesNotMatch(sql,/DROP COLUMN|DROP TABLE/);
});

test('Kysely and RLS enforce canonical Galaxy.attr instead of physical capabilities',()=>{
  const runtime=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  const managed=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const policy=readFileSync(new URL('../supabase/migrations/20261104235500_galaxy_attr_search_rls.sql',import.meta.url),'utf8');
  assert.match(runtime,/galaxyBooleanSql\('search',dialect\)/);
  assert.match(runtime,/normalizedGalaxyMutationValues/);
  assert.match(managed,/galaxyUpdateWithAttr/);
  assert.match(policy,/ALTER POLICY/);
  assert.match(policy,/attr->>/);
});
