import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/loc/views/CulturePublicReader.jsx',import.meta.url),'utf8');

test('second river offers era selection and custom range independent of first river',()=>{
  assert.match(source,/value=\{densityPeriod\}/);
  assert.match(source,/<option value='recent'>近一年（預設）<\/option>/);
  assert.match(source,/eraChoices\.map\(row=><option/);
  assert.match(source,/<option value='custom'>自訂日期<\/option>/);
  assert.match(source,/windowStart=\{rangeStart\} windowEnd=\{rangeEnd\} fixedMin=\{rangeStart\} fixedMax=\{rangeEnd\}/);
  assert.match(source,/mode='trace' windowStart=\{start\} windowEnd=\{today\}/);
});
test('keyword filter uses existing bounded public analytics, not a new SQL table',()=>{
  assert.match(source,/<option value='keyword'>關鍵詞<\/option>/);
  assert.match(source,/analytics\(scopeId,'shared_classes',null,null\)/);
  assert.doesNotMatch(source,/analytics\(scopeId,'keyword_summary'/);
  assert.match(source,/analytics\(scopeId,'culture_density',rangeStart,rangeEnd\)/);
  assert.match(source,/totalWeight=keywordGroups\.reduce/);
  assert.match(source,/Math\.floor\(total\*weights\[index\]\/denominator\)/);
  assert.match(source,/p_view:'keyword_catalog'/);
  assert.match(source,/依 Anchor 已存總量比例分配每日文化密度/);
});
test('selecting another filter resets stale article lists and source expansion',()=>{
  assert.match(source,/setDensityMode\(event\.target\.value\);setExpandedSources\(\[\]\);resetArticles\(''\)/);
  assert.match(source,/setDensityPeriod\(event\.target\.value\);resetArticles\(''\)/);
  assert.match(source,/densityMode==='source'&&densityRiver\.sites\.length/);
});

test('current Anchor keyword catalog uses groups, items and total instead of article UID lists',()=>{
  const backend=readFileSync(new URL('../app/loc/providers/kysely-analytics.mjs',import.meta.url),'utf8');
  const catalog=backend.slice(backend.indexOf('async function keywordCatalog('),backend.indexOf('async function traceDaily(',backend.indexOf('async function keywordCatalog(')));
  assert.match(catalog,/children\(root,'groups'\)/);
  assert.match(catalog,/children\(group,'items'\)/);
  assert.match(catalog,/node\?\.attr\?\.total/);
  assert.doesNotMatch(catalog,/uidlists|article\.uid/);
});
