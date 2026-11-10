import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import './test-spatial-anchor-references.mjs';
import './test-facebook-backup-place.mjs';
import {traceAnchorSuggestions,traceAnchorCompletionUid} from '../app/modular/features/trace/trace-anchor-autocomplete.mjs';
import {findAnchorWriteMatches} from '../app/modular/features/trace/trace-organizer.mjs';
import {reviewReorderedCoordinateNames,reviewPlaceNameGroups} from '../app/modular/features/trace/trace-place-names.mjs';

const anchors=[
 {uid:'A001',source_scope:'lo3rwang',trace_type:'space_anchor',title:'小柏小傑',postal_address:'臺北'},
 {uid:'a001',source_scope:'lo3rwang',trace_type:'space_anchor',title:'小柏小傑',postal_address:'高雄'},
 {uid:'B002',source_scope:'lo3rwang',trace_type:'space_anchor',title:'板橋車站'},
 {uid:'C003',source_scope:'lo3rwang',trace_type:'space_anchor',title:'無縣市地點'}
];
test('location autocomplete requires no county, GPS, floor or address',()=>{
 assert.deepEqual(traceAnchorSuggestions(anchors,'小柏').map(x=>x.uid),['A001','a001']);
 assert.deepEqual(traceAnchorSuggestions(anchors,'無縣市').map(x=>x.uid),['C003']);
 assert.deepEqual(traceAnchorSuggestions(anchors,'板橋').map(x=>x.uid),['B002']);
 assert.deepEqual(traceAnchorSuggestions(anchors,'').map(x=>x.uid),[]);
});
test('same names remain distinct and never select a candidate implicitly',()=>{
 const matches=traceAnchorSuggestions(anchors,'小柏');
 assert.equal(traceAnchorCompletionUid(matches),'');
 assert.equal(traceAnchorCompletionUid(matches,'a001'),'a001');
 assert.equal(traceAnchorCompletionUid(matches,'A001'),'A001');
 assert.equal(traceAnchorCompletionUid(matches,'other'),'');
});
test('autocomplete caps results and excludes explicitly selected UIDs',()=>{
 const sample=Array.from({length:18},(_,i)=>({uid:'X'+String(i).padStart(3,'0'),trace_type:'space_anchor',title:'重複名稱'}));
 assert.equal(traceAnchorSuggestions(sample,'重複',[],8).length,8);
 assert.deepEqual(traceAnchorSuggestions(sample,'重複',['X000'],2).map(x=>x.uid),['X001','X002']);
});
test('same name or position never silently reuses another anchor UID',()=>{
 const a={uid:'A001',source_scope:'lo3rwang',trace_type:'space_anchor',title:'某商店',
   postal_address:'文化路',address:[121.5,25.1]};
 const b={...a,uid:'a001'};
 const result=findAnchorWriteMatches(a,[b]);
 assert.equal(result.length,1);
 assert.equal(result[0].safeReuse,false);
});
test('route composer offers React Select and does not require a county selector',()=>{
 const source=readFileSync(new URL('../app/loc/TraceRouteManager.jsx',import.meta.url),'utf8');
 assert.match(source,/import ScopeOptionPicker/);
 assert.doesNotMatch(source,/from 'react-select'/);
  assert.match(source,/<ScopeOptionPicker /);
 assert.ok(source.includes('onClick={addToSpool}'));
 assert.ok(!source.includes('selectedCounty'));
 assert.ok(!source.includes('county_id'));
});

test('quick-update candidates require matching exact GPS, Scope and name characters',()=>{
 const point=(uid,title,address=[121.4638,25.0143],source_scope='lo3rwang')=>({
   uid,title,address,source_scope,trace_type:'space_anchor'
 });
 const rows=[
  point('A001','小柏小傑'),point('A002','小傑小柏'),
  point('A003','小柏小傑',[121.4639,25.0143]),
  point('A004','小柏小傑',null),
  point('A005','小傑小柏',[121.4638,25.0143],'lrunes')
 ];
 const candidates=reviewReorderedCoordinateNames(rows);
 assert.equal(candidates.length,1);
 assert.deepEqual(candidates[0].items.map(row=>row.uid),['A001','A002']);
 assert.equal(reviewReorderedCoordinateNames([point('A001','板橋車站'),point('A002','板橋車站')]).length,0);
});
test('name organizer only shows actionable complete-string reorders at the same recorded point',()=>{
 const row=(uid,title,address)=>({uid,source_scope:'lo3rwang',trace_type:'space_anchor',
   title,address});
 assert.equal(reviewPlaceNameGroups([row('A001','板橋車站',[121.5,25.1]),
   row('A002','板橋車站',[121.5,25.1])]).automatic.length,0);
 assert.equal(reviewPlaceNameGroups([row('A001','站車板橋',[121.5,25.1]),
   row('A002','板橋車站',[121.5,25.1])]).automatic.length,1);
 const different=reviewPlaceNameGroups([row('A001','站車板橋',[121.5,25.1]),
   row('A002','板橋車站',[121.6,25.1])]);
 assert.equal(different.automatic.length,0);
 assert.equal(different.uncertain.length,0);
});
test('strict full-name permutation review excludes shared generic words and other coordinates',()=>{
 const row=(uid,title,address=[121.5,25.1],source_scope='lo3rwang')=>
  ({uid,title,address,source_scope,trace_type:'space_anchor'});
 const ambiguous=[
  row('A001','高鐵台南站'),row('A002','高鐵台中站'),
  row('A003','國立台灣大學'),row('A004','國立政治大學'),
  row('A005','小柏小傑'),row('A006','小傑小柏'),
  row('A007','小傑小柏',[121.51,25.1]),
  row('A008','小柏小傑',[121.5,25.1],'lrunes')
 ];
 const candidates=reviewPlaceNameGroups(ambiguous);
 assert.equal(candidates.automatic.length,1);
 assert.deepEqual(candidates.automatic[0].items.map(row=>row.uid),['A005','A006']);
 assert.equal(candidates.uncertain.length,0);
 assert.deepEqual(reviewReorderedCoordinateNames(ambiguous)[0].items.map(row=>row.uid),
  ['A005','A006']);
});
test('spatial management dropdowns use Theme colors in route, anchor and organizer editors',()=>{
 const styles=readFileSync(new URL('../app/styles/features.css',import.meta.url),'utf8');
 const route=readFileSync(new URL('../app/loc/TraceRouteManager.jsx',import.meta.url),'utf8');
 const anchor=readFileSync(new URL('../app/loc/TraceManagement.jsx',import.meta.url),'utf8');
 const organizer=readFileSync(new URL('../app/loc/TraceOrganizer.jsx',import.meta.url),'utf8');
 for(const source of [route,anchor])assert.match(source,/<ScopeOptionPicker /);
 assert.match(styles,/\.loc-scope-option-picker/);
 assert.match(styles,/\.loc-scope-option-picker>input/);
 assert.match(styles,/:is\(\.loc-trace-anchor-editor,\.loc-trace-map-manager,\.loc-trace-article-choice\) select option/);
 assert.match(styles,/background:var\(--loc-rune-selected-bg\)/);
 assert.match(styles,/color:var\(--loc-text\)/);
 assert.match(organizer,/<select className="scope-select"/);
});

test('anchor quick-update preserves UID, is visible and uses theme-colored full-width editor',()=>{
 const ui=readFileSync(new URL('../app/loc/TraceManagement.jsx',import.meta.url),'utf8');
 const organizer=readFileSync(new URL('../app/loc/TraceOrganizer.jsx',import.meta.url),'utf8');
 const db=readFileSync(new URL('../app/modular/features/trace/trace-data.js',import.meta.url),'utf8');
 const styles=readFileSync(new URL('../app/styles/features.css',import.meta.url),'utf8');
 assert.match(ui,/reviewReorderedCoordinateNames\(ownAnchors\)/);
 assert.match(ui,/onClick=\{\(\)=>quickRename\(group\)\}/);
 assert.match(ui,/renameTraceAnchorTitles/);
 assert.match(ui,/rows=\{6\}/);
 assert.match(ui,/loc-trace-description-field/);
 assert.match(db,/\.update\(\{title:nonempty\(title,'地點標題'\)\}\)/);
 assert.match(db,/\.eq\('trace_type','space_anchor'\)\.in\('uid',ids\)/);
 assert.match(styles,/\.loc-trace-description-field\{grid-column:1\/-1\}/);
 assert.match(styles,/\.loc-scope-option-picker>select/);
 assert.match(styles,/var\(--loc-text\)/);
 assert.ok(ui.indexOf("{notice?<p") < ui.indexOf("<TraceMap spatialData={spatial}"));
 assert.doesNotMatch(organizer,/runAutomatic|合併明確文字變體/);
});
