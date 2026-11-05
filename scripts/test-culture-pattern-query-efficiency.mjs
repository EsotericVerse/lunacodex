import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Statistics and Culture count in SQL without fetching article bodies',()=>{
  const analytics=read('app/loc/providers/kysely-analytics.mjs');
  assert.match(analytics,/async function simpleCultureData\(/);
  assert.match(analytics,/eb\.fn\.countAll\(\)\.as\('item_count'\)/);
  assert.match(analytics,/\.groupBy\(\['date','site'\]\)/);
  assert.match(analytics,/async function dailyStats\(/);
  assert.match(analytics,/count\(\*\)::integer as item_count/);
});

test('Search first stage returns thin results, not content or COUNT for every match',()=>{
  const search=read('app/loc/galaxy-query.js');
  assert.match(search,/const textColumns=\['uid','title','createtime'/);
  assert.match(search,/columns:textColumns,searchFields:\['content'\]/);
  assert.match(search,/Fetch one extra row instead/);
  assert.match(search,/totalCount:null/);
});

test('Trace map index filters only path and trace in the database',()=>{
  const trace=read('app/modular/features/trace/trace-data.js');
  assert.match(trace,/types:\['path','trace'\],nativeOnly,includeHidden/);
  assert.match(trace,/\.in\('type',selectedTypes\)/);
  assert.match(trace,/if\(types\)query=query\.in\('trace_type',types\)/);
  assert.match(trace,/return readPages\(id,\{filter:'space_anchor',limit:10\}\)/);
  assert.doesNotMatch(trace,/await readAllTraceAnchors\(scopeId,\{nativeOnly:scopeId==='loc'\}\)\)\.slice\(0,10\)/);
});
