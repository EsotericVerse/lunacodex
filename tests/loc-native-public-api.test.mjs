import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const browser=readFileSync(new URL('../public/loc-native-client.mjs',import.meta.url),'utf8');
const query=readFileSync(new URL('../functions/api/loc-public-query.js',import.meta.url),'utf8');
const content=readFileSync(new URL('../functions/api/loc-public-content.js',import.meta.url),'utf8');

test('LOC native islands only call existing public read endpoints',()=>{
  assert.doesNotMatch(browser,/\/api\/loc-framework(?:\?|['"])/);
  assert.match(browser,/\/api\/loc-public-content\?/);
  assert.match(browser,/\/api\/loc-public-query/);
  assert.match(query,/handleNativePublicQuery/);
  assert.match(content,/handleNativePublicContent/);
});

test('native public reads stay on published Scope and modeled relations',()=>{
  assert.match(browser,/PUBLIC_SCOPES=\['lo3rwang','lrunes'\]/);
  assert.match(browser,/\['galaxy','anchor'\]\.includes\(kind\)/);
  assert.match(browser,/schema:'silver',table:target\+'_'\+kind/);
  assert.match(browser,/\{column:'search',op:'eq',value:true\}/);
  assert.match(browser,/\{column:'invisible',op:'eq',value:false\}/);
  assert.match(browser,/p_view:view/);
  assert.match(browser,/kind,scope:target/);
});

test('native Culture and Statistics consume the actual numeric public shapes',()=>{
  assert.match(browser,/publicContent\('culture_density',scope,true\)/);
  assert.match(browser,/publicContent\('totals',scope\)/);
  assert.match(browser,/publicContent\('loc','loc'\)/);
  assert.match(browser,/row\.day/);
  assert.match(browser,/row\.item_count/);
  assert.match(browser,/row\.category/);
});

test('native Trace reads published Point Anchors, not analytics counts as coordinates',()=>{
  assert.match(browser,/publicSelect\(target,'anchor',\['uid','title','attr'\]/);
  assert.match(browser,/Number\(attr\?\.longitude\),latitude=Number\(attr\?\.latitude\)/);
  assert.doesNotMatch(browser,/read\('trace'\)/);
});
