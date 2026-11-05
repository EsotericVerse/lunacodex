import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEraRiver} from '../app/loc/culture-time-trace-river.mjs';

const anchor={scope_id:'lo3rwang',uid:'D1234567',entry_type:'anchor',start_date:'2026-03-15',title:'定錨'};
const interval={scope_id:'lo3rwang',uid:'P1234567',entry_type:'period',title:'期間 A',
  ranges:[{start_date:'2026-03-01',end_date:'2026-03-31'}]};
const era={scope_id:'lo3rwang',uid:'E1234567',entry_type:'era',title:'時代 A',
  anchor_ids:['P1234567'],ranges:[{start_date:'2026-03-01',end_date:'2026-03-31'}]};
const options={editorOnly:true};

test('time editor first river shows eras and date points on era lane when collapsed',()=>{
  const model=buildEraRiver([era,interval,anchor],[],options);
  assert.deepEqual(model.groups.map(group=>group.id),['trace:lo3rwang:E1234567']);
  assert.ok(model.items.some(item=>item.entry_type==='era'&&item.group_key==='trace:lo3rwang:E1234567'));
  assert.ok(model.items.some(item=>item.entry_type==='anchor'&&item.group_key==='trace:lo3rwang:E1234567'));
  assert.ok(!model.items.some(item=>item.entry_type==='period'));
});

test('expanding era reveals only its nested periods without an extra anchor lane',()=>{
  const model=buildEraRiver([era,interval,anchor],['trace:lo3rwang:E1234567'],options);
  assert.deepEqual(model.groups.map(group=>group.id),
    ['trace:lo3rwang:E1234567','trace:lo3rwang:E1234567:period:P1234567']);
  assert.ok(model.items.some(item=>item.entry_type==='period'&&item.uid==='P1234567'));
  assert.ok(!model.groups.some(group=>group.id.startsWith('time-anchors:')||group.id.includes('trace-anchors:')));
});

test('spatial name list stays in flow and route autocomplete remains independent',()=>{
  const component=readFileSync(new URL('../app/loc/TraceOrganizer.jsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/styles/features.css',import.meta.url),'utf8');
  const nameStyles=css.slice(css.indexOf('.loc-trace-name-results{'),css.indexOf('.loc-trace-route-suggestions{'));
  assert.match(component,/className="loc-trace-name-results"/);
  assert.doesNotMatch(component,/className="loc-trace-route-suggestions"/);
  assert.match(nameStyles,/position:static/);
  assert.match(nameStyles,/overflow-y:auto/);
  assert.match(nameStyles,/max-width:100%/);
});

test('time editor has the same one-calendar-year viewport as public culture',()=>{
  const code=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  assert.match(code,/function editorRiverYearWindow\(/);
  assert.match(code,/date\.setUTCFullYear\(date\.getUTCFullYear\(\)-1\)/);
  assert.match(code,/windowStart=\{editorRiverWindow\.start\}/);
  assert.match(code,/windowEnd=\{editorRiverWindow\.end\}/);
});
