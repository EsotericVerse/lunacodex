import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC Trace mounts the separate route preview, Scope keeps its full trace page',()=>{
  const component=read('app/modular/features/Trace.jsx');
  assert.match(component,/return scopeId==='loc'\?<LocTracePreview\/>:<ScopeTrace scopeId=\{scopeId\}\/>/);
  assert.match(component,/function ScopeTrace\(/);
  assert.match(component,/TraceTerritoryPanel scopeId=\{scopeId\}/);
});
test('LOC preview never queries annual Galaxy, loc_anchor or standalone place lists',()=>{
  const component=read('app/modular/features/LocTracePreview.jsx');
  assert.match(component,/readTraceMapIndex\('loc'\)/);
  assert.match(component,/\['path','trace'\]\.includes\(row\.trace_type\)/);
  assert.match(component,/queryFn:\(\)=>readCurrentTraceAnchors\(selected\.source_scope,memberIds\)/);
  assert.match(component,/selected\.route_list\?\.routes/);
  assert.doesNotMatch(component,/TraceTerritoryPanel|trace_territory|trace_daily|readAllTraceAnchors|loc_anchor|annualSummary|Galaxy/);
  assert.doesNotMatch(component,/readCurrentTraceAnchors\('loc'/);
  assert.match(component,/hideRoutePicker showAnchorSearch=\{false\}/);
});
test('LOC route-only map draws lines, no standalone points, no time axis',()=>{
  const map=read('app/modular/features/trace/TraceMap.jsx');
  assert.match(map,/anchors:routeOnly\?\[\]:spatialData\?\.anchors\|\|\[\]/);
  assert.match(map,/setAnchors\(routeOnly\?\[\]:spatialData\?\.anchors\|\|\[\]\)/);
  assert.match(map,/feature\.geometry\?\.type==='LineString'/);
  assert.match(map,/!routeOnly&&!selectingLocation&&!territoryMode&&spatialData/);
  assert.match(map,/instance\?\.destroy\(\)/);
});
test('LOC Trace route index reads only published member Scope storage',()=>{
  const data=read('app/modular/features/trace/trace-data.js');
  assert.match(data,/if\(id==='loc'\)return mapBounded\(await groupTraceSources\(\),3,/);
  assert.match(data,/types:\['path','trace'\]/);
  assert.match(data,/if\(id==='loc'\)return \[\];/);
  assert.match(data,/from\(id\+'_anchor'\)/);
});
