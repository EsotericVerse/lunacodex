import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 timelineVisitWindows,timelineCoordinates,matchTimelineWindows,accumulateTimelineArticles,groupTimelineMissingPlaces,selectedTimelineArticleUpdates
} from '../app/loc/timeline-place-matcher.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const row=(uid,title,lat,lng)=>({uid,title,trace_type:'space_anchor',address:[lng,lat]});


test('custom Timeline date range filters out other years and includes both boundary dates',()=>{
 const document={semanticSegments:[
  {startTime:'2025-12-31T23:00:00Z',endTime:'2026-01-01T01:00:00Z',visit:{topCandidate:{placeLocation:{latLng:'25°,121°'}}}},
  {startTime:'2026-06-01T11:00:00Z',endTime:'2026-06-01T12:00:00Z',visit:{topCandidate:{placeLocation:{latLng:'25°,121°'}}}},
  {startTime:'2027-01-01T00:00:00Z',endTime:'2027-01-01T01:00:00Z',visit:{topCandidate:{placeLocation:{latLng:'25°,121°'}}}}
 ]};
 const selected=timelineVisitWindows(document,{startDate:'2026-01-01',endDate:'2026-12-31'});
 assert.equal(selected.length,2);
 assert.equal(selected[0].from,'2026-01-01T00:00:00.000Z');
 assert.equal(selected[1].from,'2026-06-01T11:00:00.000Z');
 const day=timelineVisitWindows(document,{startDate:'2026-06-01',endDate:'2026-06-01'});
 assert.equal(day.length,1);
 assert.equal(day[0].from,'2026-06-01T11:00:00.000Z');
});
test('Timeline review queries Galaxy by date in one-year range without per-window RPC',()=>{
 const ui=read('app/loc/TimelinePlaceManager.jsx');
 assert.match(ui,/\.gte\('date',startDate\)\.lt\('date',nextDate\)/);
 assert.match(ui,/setUTCFullYear\(yearLater\.getUTCFullYear\(\)\+1\)/);
 assert.doesNotMatch(ui,/rpc\('preview_timeline_place_page_json'/);
});

test('new Google phone Timeline uses visits, ignores movements, preserves offset',()=>{
 const document={semanticSegments:[
  {startTime:'2026-10-01T09:00:00+08:00',endTime:'2026-10-01T10:00:00+08:00',
   visit:{topCandidate:{placeLocation:{latLng:'25.0123°, 121.4567°'},probability:0.8}}},
  {startTime:'2026-10-01T10:00:00+08:00',endTime:'2026-10-01T11:00:00+08:00',
   activity:{start:{latLng:'25.0100°, 121.4510°'}}}
 ]};
 const result=timelineVisitWindows(document);
 assert.equal(result.length,1);
 assert.equal(result[0].from,'2026-10-01T01:00:00.000Z');
 assert.equal(result[0].uncertain,false);
});
test('legacy Timeline placeVisit and E7 coordinates work',()=>{
 const old={timelineObjects:[{placeVisit:{location:{latitudeE7:250123000,longitudeE7:1214567000},
 duration:{startTimestamp:'2026-10-01T00:00:00Z',endTimestamp:'2026-10-01T01:00:00Z'}}}]};
 const v=timelineVisitWindows(old);
 assert.equal(v.length,1);
 assert.equal(v[0].lat,25.0123);
 assert.equal(v[0].lng,121.4567);
 assert.deepEqual(timelineCoordinates('geo:25.0123,121.4567'),{lat:25.0123,lng:121.4567});
});
test('outside 500m stays empty; two inside 500m become disputed',()=>{
 const windows=timelineVisitWindows({semanticSegments:[{startTime:'2026-01-01T00:00:00Z',
 endTime:'2026-01-01T01:00:00Z',visit:{topCandidate:{placeLocation:{latLng:'25°,121°'}}}}]});
 const anchors=[row('A001','甲',25,121),row('A002','乙',25,121.001),row('B003','遠方',26,121)];
 const match=matchTimelineWindows(windows,anchors);
 assert.equal(match.windows.length,1);
 assert.deepEqual(match.windows[0].candidates.map(c=>c.uid),['A001','A002']);
 assert.equal(match.windows[0].disputed,true);
 assert.equal(matchTimelineWindows(windows,[anchors[2]]).withoutAnchor,1);
});
test('place_id controls review completion regardless of existing location',()=>{
 const window={candidates:[{uid:'A001',title:'甲',meters:20}],disputed:false};
 const rows=[{uid:'11111111',title:'文章',createtime:'2026-01-01T00:10:00Z',place_id:null,location:'已打卡',window},
  {uid:'22222222',title:'已存在',createtime:'2026-01-01T00:10:00Z',place_id:'B002',window},
  {uid:'33333333',title:'相同',createtime:'2026-01-01T00:10:00Z',place_id:'A001',window}];
 const result=accumulateTimelineArticles(rows);
 assert.deepEqual(result.ready.map(x=>x.uid),['11111111']);
 assert.deepEqual(result.disputes.map(x=>x.uid),[]);
 assert.deepEqual(result.unchanged.map(x=>x.uid),[]);
});
test('overlapping visits to different places never auto apply a guessed ID',()=>{
 const hit=(placeId)=>({uid:'11111111',title:'文章',createtime:'2026-01-01T00:10:00Z',
 place_id:null,window:{candidates:[{uid:placeId,title:placeId,meters:20}],disputed:false}});
 const x=accumulateTimelineArticles([hit('A001'),hit('B002')]);
 assert.equal(x.ready.length,0);
 assert.equal(x.disputes.length,1);
});
test('same Timeline coordinate groups hundreds of distinct article rows without merging them',()=>{
 const window={lat:25.0123,lng:121.4567,candidates:[
   {uid:'A001',title:'一樓',meters:0},{uid:'A002',title:'二樓',meters:0}],disputed:true};
 const hits=Array.from({length:300},(_,i)=>({
   uid:String(i).padStart(8,'0'),title:'紀錄 '+i,place_id:null,createtime:'2026-01-01',
   window
 }));
 const groups=groupTimelineMissingPlaces(accumulateTimelineArticles(hits));
 assert.equal(groups.length,1);
 assert.equal(groups[0].rows.length,300);
 assert.equal(groups[0].defaultPlaceId,'');
 assert.deepEqual(groups[0].candidates.map(c=>c.uid),['A001','A002']);
});
test('different GPS observations at one anchor share one review group',()=>{
 const hits=[25.0123000,25.0123001].map((lat,i)=>({
  uid:String(i).padStart(8,'0'),place_id:null,
  window:{lat,lng:121.4567,candidates:[{uid:'A001',title:'甲',meters:0}],disputed:false}
 }));
 const groups=groupTimelineMissingPlaces(accumulateTimelineArticles(hits));
 assert.equal(groups.length,1);
 assert.equal(groups[0].key,'anchor:A001');
 assert.equal(groups[0].rows.length,2);
});
test('one article matched at different coordinates cannot be swept into a bulk group',()=>{
 const hit=(lat,placeId)=>({uid:'11111111',place_id:null,window:{
   lat,lng:121,candidates:[{uid:placeId,title:placeId,meters:1}],disputed:false
 }});
 const single={uid:'22222222',place_id:null,window:{
   lat:25,lng:121,candidates:[{uid:'A001',title:'甲',meters:1}],disputed:false
 }};
 const groups=groupTimelineMissingPlaces(accumulateTimelineArticles([hit(25,'A001'),hit(26,'B002'),single]));
 assert.equal(groups.length,2);
 assert.ok(groups.some(g=>g.key==='article:11111111'&&g.defaultPlaceId===''));
 assert.equal(groups.reduce((n,g)=>n+g.rows.filter(row=>row.uid==='11111111').length,0),1);
});
test('UI is owner-only, grouped with default checkboxes, and location is protected',()=>{
 const ui=read('app/loc/TimelinePlaceManager.jsx');
 const page=read('app/loc/PlaceManagement.jsx');
 const migration=read('supabase/migrations/20261028140000_timeline_missing_location_review.sql');
 assert.match(page,/Timeline 地點整理/);
 assert.match(ui,/readAllTraceAnchors\(scopeId,\{includeHidden:true\}\)/);
 assert.match(ui,/if\(!window\.confirm\(/);
 assert.match(ui,/groupTimelineMissingPlaces\(analysis\)/);
 assert.match(ui,/const \[excluded,setExcluded\]=useState\(\{\}\)/);
 assert.match(ui,/!excluded\[row\.uid\]/);
 assert.match(ui,/p_scope_id:scopeId,p_updates:batch/);
 assert.match(ui,/rpc\('scope_type_attr'/);
 assert.match(ui,/op:'link',mode:'place_id',updates:batch/);
 assert.doesNotMatch(ui,/rpc\('apply_timeline_missing_places'/);
 const revised=read('supabase/migrations/20261028183000_timeline_io_maxrows_10000.sql');
 assert.match(revised,/AND NULLIF\(btrim\(place_id\),''\) IS NULL/);
 assert.match(revised,/UPDATE silver\.%I g SET place_id = u\.place_id/);
 assert.match(revised,/WHERE g\.uid = u\.uid AND NULLIF\(btrim\(g\.place_id\),''\) IS NULL/);
 assert.match(revised,/preview_timeline_place_page_json/);
 assert.match(migration,/silver\.can_manage_scope\(p_scope_id\)/);
});

test('two groups keep independent choices and one article override cannot leak to other groups',()=>{
 const candidate=(uid)=>({uid,title:uid,meters:1});
 const row=(uid,candidates,existingPlaceId='')=>({uid,candidates,existingPlaceId});
 const groups=[
  {key:'point:1',defaultPlaceId:'',rows:[row('11111111',[candidate('A001'),candidate('A002')])]},
  {key:'point:2',defaultPlaceId:'',rows:[row('22222222',[candidate('B001'),candidate('B002')])]},
  {key:'point:3',defaultPlaceId:'',rows:[row('33333333',[candidate('C001')],'C001')]}
 ];
 assert.deepEqual(selectedTimelineArticleUpdates(groups,{ 'point:1':'A002','point:2':'B001','point:3':'C001' }),[
  {uid:'11111111',place_id:'A002',expected_place_id:null,manual:true},
  {uid:'22222222',place_id:'B001',expected_place_id:null,manual:true}
 ]);
 assert.deepEqual(selectedTimelineArticleUpdates(groups,{'point:1':'A001','point:2':'B001','point:3':'B001'},
   {'11111111':'A002'},{'22222222':true}).map(x=>x.place_id),['A002']);
});

test('per-tab Timeline review cache is owner-bound, scoped, and does not contain raw JSON',async()=>{
 const {saveTimelineReviewSession,loadTimelineReviewSession,clearTimelineReviewSession}=
   await import('../app/loc/timeline-review-session.mjs');
 const map=new Map();const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const analysis={ready:[{uid:'11111111',title:'文章',candidates:[]}],disputes:[],unchanged:[]};
 assert.equal(saveTimelineReviewSession(storage,{scopeId:'lo3rwang',owner:'owner-a',analysis,
   groupChoices:{'point:1':'A001'},itemChoices:{},excluded:{},completedCount:0}),true);
 assert.equal(loadTimelineReviewSession(storage,{scopeId:'lo3rwang',owner:'owner-b'}),null);
 assert.equal(loadTimelineReviewSession(storage,{scopeId:'lrunes',owner:'owner-a'}),null);
 assert.equal(loadTimelineReviewSession(storage,{scopeId:'lo3rwang',owner:'owner-a'}),null);
 saveTimelineReviewSession(storage,{scopeId:'lo3rwang',owner:'owner-a',analysis,
   groupChoices:{'point:1':'A001'},itemChoices:{},excluded:{},completedCount:0});
 assert.deepEqual(loadTimelineReviewSession(storage,{scopeId:'lo3rwang',owner:'owner-a'}).analysis.ready,analysis.ready);
 assert.equal(String([...map.values()][0]).includes('11111111'),false);
 clearTimelineReviewSession(storage,'lo3rwang');assert.equal(map.size,0);
});

test('Timeline preview is index-backed and JS MaxRows equals SQL transport cap',()=>{
 const io=read('app/loc/query-batch-size.mjs');
 const writeSql=read('supabase/migrations/20261028183000_timeline_io_maxrows_10000.sql');
 const previewSql=read('supabase/migrations/20261028183000_timeline_io_maxrows_10000.sql');
 const ui=read('app/loc/TimelinePlaceManager.jsx');
 assert.match(io,/windowBatch:MAX_ROWS,previewPage:MAX_ROWS,writeBatch:MAX_ROWS/);
 assert.match(previewSql,/OFFSET 0/);
 assert.match(previewSql,/p_limit NOT BETWEEN 1 AND 10000/);
 assert.match(writeSql,/total NOT BETWEEN 1 AND 10000/g);
 assert.doesNotMatch(writeSql,/FOR r IN/);
 assert.match(writeSql,/GET DIAGNOSTICS affected = ROW_COUNT/);
 assert.ok(ui.indexOf('loc-timeline-review-action')<ui.indexOf('loc-timeline-review-groups'));
 assert.match(ui,/saveTimelineReviewSession/);
 assert.match(ui,/selectedTimelineArticleUpdates/);
});
