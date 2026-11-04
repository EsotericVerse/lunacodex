import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scopeConfigColumns,scopeFeatureColumns,scopeFeatureEnabled,scopeFeaturePatch,scopeFeatureName,scopeTagColumn,scopeTagNames} from '../app/loc/scope-config-fields.mjs';

test('lo3rwang and lrunes each use four real Scope booleans',()=>{
  const expected='trace,search,culture,statics';
  assert.equal(scopeFeatureColumns('lo3rwang'),expected);
  assert.equal(scopeFeatureColumns('lrunes'),expected);
  assert.ok(scopeConfigColumns('lrunes').endsWith(','+expected));
  assert.equal(scopeFeatureName('statistics_able'),'statics');
  const settings={id:'lo3rwang',culture:false,statics:true,search:false,trace:true};
  assert.equal(scopeFeatureEnabled(settings,'culture_able'),false);
  assert.equal(scopeFeatureEnabled(settings,'statistics_able'),true);
  assert.equal(scopeFeatureEnabled(settings,'search_able'),false);
  assert.equal(scopeFeatureEnabled(settings,'trace'),true);
  assert.deepEqual(scopeFeaturePatch('lo3rwang',settings),
    {search:false,statics:true,culture:false,trace:true});
  assert.deepEqual(scopeFeaturePatch('lrunes',{id:'lrunes',search:false,statics:true,culture:true,trace:false}),
    {search:false,statics:true,culture:true,trace:false});
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
test('feature gates and admin Scope UI use four boolean columns',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const app=read('app/loc/LocApp.jsx'),admin=read('app/loc/views/admin-panels/AdminRegistry.jsx');
  const ui=read('app/modular/ui.jsx'),scope=read('app/loc/scope-data.js');
  assert.match(scope,/scopeConfigColumns\(scope\.id\)/);
  assert.match(admin,/scopeFeaturePatch\(current\.scope_id,currentConfig\)/);
  assert.match(admin,/\[scopeFeatureName\(key\)\]:Boolean\(value\)/);
  assert.match(app,/trace:'trace'/);
  assert.match(app,/search:'search_able'/);
  assert.match(ui,/scopeId==='lo3rwang'/);
  assert.match(read('scripts/generate-public-blocks.mjs'),/scopeConfigColumns\(id\)/);
});

test('LOC theme follows Taipei day/night; the saved Scope theme must not override it',()=>{
  const source=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  assert.match(source,/const configEnabled=!fixedDefaultThemeId&&scope\.id!=='loc'&&/);
});
