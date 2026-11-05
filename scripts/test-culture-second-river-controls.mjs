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
  assert.match(source,/analytics\(scopeId,'keyword_summary',rangeStart,rangeEnd,\{classUid:keywordClass\}\)/);
  assert.match(source,/p_view:'keyword_catalog'/);
  assert.match(source,/row\.kind==='class_day'/);
});
test('selecting another filter resets stale article lists and source expansion',()=>{
  assert.match(source,/setDensityMode\(event\.target\.value\);setExpandedSources\(\[\]\);resetArticles\(''\)/);
  assert.match(source,/setDensityPeriod\(event\.target\.value\);resetArticles\(''\)/);
  assert.match(source,/densityMode==='source'&&densityRiver\.sites\.length/);
});
