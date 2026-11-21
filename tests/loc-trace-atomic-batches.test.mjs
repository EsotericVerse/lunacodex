import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Trace visibility and title batches use exact SQL transaction row receipts',()=>{
  const data=source('../app/modular/features/trace/trace-data.js');
  assert.match(data,/function traceUidChanges\(scope,ids,values\)/);
  assert.match(data,/p_expected_count:batch\.length/);
  assert.match(data,/p_filters:\[\{column:'type',operator:'eq',value:'point'\}/);
  assert.match(data,/await transactionWrites\(traceUidChanges\(id,ids,/);
  assert.doesNotMatch(data,/ids\.length>200\|\|ids\.some/);
});

test('Trace bulk Point creation is an all-or-nothing INSERT',()=>{
  const data=source('../app/modular/features/trace/trace-data.js');
  const begin=data.indexOf('export async function addTraceAnchorsBatch(');
  const end=data.indexOf('function validatedConnections(',begin);
  assert.ok(begin>=0&&end>begin);
  const body=data.slice(begin,end);
  assert.match(body,/await transactionWrites\(\[\{/);
  assert.doesNotMatch(body,/for\(let offset=0;offset<inserts\.length/);
  assert.match(body,/const count=rows\.length/);
});

test('Trace UI no longer commits batches in independent loops',()=>{
  const route=source('../app/loc/trace/RouteManager.jsx');
  const manage=source('../app/loc/trace/TraceManagement.jsx');
  assert.doesNotMatch(route,/uids\.slice\(i,i\+200\)/);
  assert.doesNotMatch(manage,/task\.uids\.slice\(i,i\+100\)/);
  assert.doesNotMatch(manage,/visibility\.uids\.slice\(i,i\+200\)/);
});
