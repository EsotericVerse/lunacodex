import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  traceTimeEvents,traceTimeBounds,traceTimeAt,traceTimeProgress,traceTimeActiveKeys
} from '../app/modular/features/trace/trace-time-axis.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const points=[
  {uid:'AABB0011',source_scope:'lo3rwang',trace_type:'space_anchor',
    times:['2024-01-01T00:00:00Z','2024-01-01T00:00:00.000Z','2026-01-01T00:00:00Z']},
  {uid:'BBCC0022',source_scope:'lo3rwang',trace_type:'space_anchor',
    times:['2025-01-01T00:00:00Z']},
  {uid:'CCDD0033',source_scope:'lo3rwang',trace_type:'space_anchor',times:[]}
];
test('time axis uses exact elapsed milliseconds, never evenly spaced events',()=>{
  const events=traceTimeEvents(points),bounds=traceTimeBounds(events);
  assert.equal(events.length,3,'duplicate timestamps on same Point dedupe');
  assert.equal(bounds.count,3);
  assert.equal(traceTimeAt(bounds,0),Date.parse('2024-01-01T00:00:00Z'));
  assert.equal(traceTimeAt(bounds,1),Date.parse('2026-01-01T00:00:00Z'));
  const midpoint=traceTimeAt(bounds,.5);
  assert.equal(midpoint,(bounds.start+bounds.end)/2);
  assert.ok(traceTimeProgress(bounds,Date.parse('2025-01-01T00:00:00Z'))>.5);
  assert.deepEqual(traceTimeActiveKeys(events,midpoint),['lo3rwang:AABB0011']);
  assert.deepEqual(traceTimeActiveKeys(events,bounds.end),[
    'lo3rwang:AABB0011','lo3rwang:BBCC0022']);
});
test('empty, invalid and same-instant Point histories are safe',()=>{
  assert.equal(traceTimeBounds(traceTimeEvents([])),null);
  const events=traceTimeEvents([{uid:'AB12abcd',source_scope:'lrunes',
    trace_type:'space_anchor',attr:{times:['2026-11-06T00:00:00Z','bad']}}]);
  const bounds=traceTimeBounds(events);
  assert.equal(events.length,1);
  assert.equal(traceTimeAt(bounds,.7),bounds.start);
  assert.deepEqual(traceTimeActiveKeys(events,bounds.start),['lrunes:AB12abcd']);
  assert.equal(traceTimeProgress(bounds,bounds.start),1);
});
test('LOC shared geographic pin preserves member-specific time contributions',()=>{
  const clustered=[{uid:'AABB0011',source_scope:'lo3rwang',trace_type:'space_anchor',
    members:[
      {uid:'AABB0011',source_scope:'lo3rwang',times:['2024-01-01T00:00:00Z']},
      {uid:'MMNN1122',source_scope:'lrunes',times:['2026-01-01T00:00:00Z']}
    ]}];
  const events=traceTimeEvents(clustered);
  assert.equal(events.length,2);
  assert.equal(events[0].pointKey,events[1].pointKey);
});
test('map and public Trace wire time cursor without article-list queries',()=>{
  const map=read('app/modular/features/trace/trace-map-engine.js');
  const react=read('app/modular/features/trace/TraceMap.jsx');
  const trace=read('app/modular/features/Trace.jsx');
  assert.match(map,/setTimeCursor\(keys=\[\]\)/);
  assert.match(map,/loc-trace-time-active-points/);
  assert.match(react,/traceTimeEvents\(spatialData\?\.anchors\|\|\[\]\)/);
  assert.match(react,/type="range" min="0" max="1000"/);
  assert.match(react,/mapRef\.current\?\.setTimeCursor\(timeActiveKeys\)/);
  assert.match(react,/window\.clearInterval\(timer\)/);
  assert.doesNotMatch(react,/readScopePlaceStatistics|readScopeArticles/);
  assert.match(trace,/selectedRouteUid=\{isLoc\?'':twoPointDemo/);
  assert.doesNotMatch(trace,/setReportTab\('articles'\)/);
});
