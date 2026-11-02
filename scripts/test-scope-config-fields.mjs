import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scopeConfigColumns,scopeFeatureColumns,scopeFeatureEnabled,scopeFeaturePatch,scopeFeatureName,scopeTagColumn,scopeTagNames} from '../app/loc/scope-config-fields.mjs';

test('lo3rwang uses one able JSONB with short keys and 0/1 flags',()=>{
  assert.equal(scopeFeatureColumns('lo3rwang'),'able');
  assert.equal(scopeFeatureColumns('lrunes'),'search_able,statistics_able,culture_able');
  assert.equal(scopeFeatureName('statistics_able'),'statics');
  const settings={able:{culture:0,statics:1,search:0,trace:1}};
  assert.equal(scopeFeatureEnabled(settings,'culture_able'),false);
  assert.equal(scopeFeatureEnabled(settings,'statistics_able'),true);
  assert.equal(scopeFeatureEnabled(settings,'search_able'),false);
  assert.equal(scopeFeatureEnabled(settings,'trace'),true);
  assert.deepEqual(scopeFeaturePatch('lo3rwang',settings),{able:{search:0,statics:1,culture:0,trace:1}});
  assert.equal(scopeFeatureColumns('loc'),'');
  assert.equal(scopeConfigColumns('loc'),'id,display_name,locale');
  assert.deepEqual(scopeFeaturePatch('loc',{search_able:false}),{});
});
test('ArticleTag JSONB stays independent of compact feature switches',()=>{
  const tags=['suno','kkcity','其他'];
  assert.equal(scopeTagColumn('lo3rwang'),'ArticleTag');
  assert.equal(scopeTagColumn('loc'),'DefaultArticleClass');
  assert.equal(scopeTagColumn('lrunes'),'txt_class');
  assert.deepEqual(scopeTagNames('lo3rwang',{ArticleTag:tags}),tags);
  assert.deepEqual(scopeTagNames('loc',{DefaultArticleClass:tags}),tags);
});
test('feature gates and the admin UI use only the single numeric able map for lo3rwang',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const app=read('app/loc/LocApp.jsx'),admin=read('app/loc/views/admin-panels/AdminRegistry.jsx');
  const ui=read('app/modular/ui.jsx'),scope=read('app/loc/scope-data.js');
  assert.match(scope,/scopeConfigColumns\(scope\.id\)/);
  assert.match(admin,/scopeFeaturePatch\(current\.scope_id,currentConfig\)/);
  assert.match(admin,/\[scopeFeatureName\(key\)\]:value\?1:0/);
  assert.match(app,/trace:'trace'/);
  assert.match(app,/search:'search_able'/);
  assert.match(ui,/scopeId==='lo3rwang'/);
  assert.match(read('scripts/generate-public-blocks.mjs'),/scopeConfigColumns\(id\)/);
});

test('LOC theme follows Taipei day/night; the saved Scope theme must not override it',()=>{
  const source=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  assert.match(source,/const configEnabled=!fixedDefaultThemeId&&scope\.id!=='loc'&&/);
});
