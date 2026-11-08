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
test('keyword river displays real dated word-index hits, not invented Anchor weights',()=>{
  assert.match(source,/<option value='keyword'>關鍵詞<\/option>/);
  assert.match(source,/keywordService\('classes',\{scopeId\}\)/);
  assert.match(source,/keywordService\('stats'/);
  assert.match(source,/\.filter\(row=>row\.kind==='class_day'\)/);
  assert.doesNotMatch(source,/依 Anchor 已存總量|Math\.floor\(total\*weights/);
  assert.match(source,/analytics\(scopeId,'culture_density',rangeStart,rangeEnd\)/);
});

test('selecting another filter resets stale article lists and source expansion',()=>{
  assert.match(source,/setDensityMode\(event\.target\.value\);setExpandedSources\(\[\]\);resetArticles\(''\)/);
  assert.match(source,/setDensityPeriod\(event\.target\.value\);resetArticles\(''\)/);
  assert.match(source,/densityMode==='source'&&densityRiver\.sites\.length/);
});

test('Kysely Keyword catalog reports pattern-computed totals without reading Anchor.attr.total',()=>{
  const backend=readFileSync(new URL('../app/loc/providers/kysely-analytics.mjs',import.meta.url),'utf8');
  const from=backend.indexOf('async function keywordCatalog(');
  const to=backend.indexOf('async function traceDaily(',from);
  const catalog=backend.slice(from,to);
  assert.match(catalog,/keywordPatternItemMetrics\(/);
  assert.match(catalog,/readScopePatternRows\(trx,scope,await scopeDatabaseUid\(trx,scope\)\)/);
  assert.doesNotMatch(catalog,/attr\?\.total|attr->>'total'/);

});
