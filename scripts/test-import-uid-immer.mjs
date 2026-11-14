// Run after npm ci: node scripts/test-import-uid-immer.mjs
// No database, network or deployment. Exercises the real installed Immer.
import assert from 'node:assert/strict';
import {
  createImportUidResolver,remapImportUidRelations,
  planExistingImportUidUpdate,planImportPointUidLink,planImportMediaUidLinks
} from '../app/loc/import-uid-delta.mjs';
import {
  createImportPlaceIndex,prepareImportPlaceAnchors,
  importedPlaceId,recordImportPlaceVisits
} from '../app/loc/import-place-anchors.mjs';
import {createImportDateIndex,prepareImportTimeAnchors} from '../app/loc/import-time-anchors.mjs';
import {
  planImportPointVisitDelta,planImportDateTitleDelta,
  planImportPointCreate,planImportDateCreate
} from '../app/loc/import-point-date-immer.mjs';

const aliases=new Map([
  ['AAA00001','BBB00002'],['BBB00002','CCC00003'],
  ['CCC00003','CCC00003']
]);
const persisted=new Map([['CCC00003',{uid:'DDD00004'}]]);
const incoming={
  uid:'POST0001',content:'original text',location:'A place',
  source_id:'AAA00001',ref_id:'BBB00002',
  target_id:['AAA00001','BBB00002','OTHER005']
};
const unchanged={uid:'POST0002',source_id:'OTHER005',target_id:[]};
const remapped=remapImportUidRelations([incoming,unchanged],{
  aliases,existingByUid:persisted
});
assert.equal(remapped.rows[0].source_id,'DDD00004');
assert.equal(remapped.rows[0].ref_id,'DDD00004');
assert.deepEqual(remapped.rows[0].target_id,['DDD00004','OTHER005']);
assert.equal(remapped.rows[0].content,incoming.content);
assert.equal(remapped.rows[0].location,incoming.location);
assert.equal(incoming.source_id,'AAA00001');
assert.equal(remapped.rows[1],unchanged);
assert.deepEqual([...Object.keys(remapped.changesByUid.get('POST0001').changes)].sort(),
  ['ref_id','source_id','target_id']);
assert.equal(remapped.changesByUid.has('POST0002'),false);
assert.throws(()=>createImportUidResolver(new Map([
  ['AAA00001','BBB00002'],['BBB00002','AAA00001']
]))('AAA00001'),/循環/);
assert.throws(()=>planImportMediaUidLinks([],[' MEDIA001']),/八碼 UID/);

const resolve=createImportUidResolver(aliases,persisted);
const existing={
  uid:'POST0001',source_id:'AAA00001',ref_id:'BBB00002',
  target_id:['AAA00001','BBB00002'],place_id:'POINT001'
};
const delta=planExistingImportUidUpdate(existing,remapped.rows[0],{
  resolveSavedUid:id=>resolve(id),placeUid:'POINT001'
});
assert.deepEqual(delta.changes,{
  source_id:'DDD00004',ref_id:'DDD00004',target_id:['DDD00004']
});
assert.equal(existing.source_id,'AAA00001');
const noChange=planExistingImportUidUpdate({
  ...existing,source_id:'DDD00004',ref_id:'DDD00004',
  target_id:['DDD00004'],place_id:'POINT001'
},remapped.rows[0],{placeUid:'POINT001'});
assert.deepEqual(noChange.changes,{});
assert.deepEqual(noChange.patches,[]);
// One pass over existing articles prepares link patches; Point is applied
// separately after its exact saved PK is resolved.
assert.deepEqual(planImportPointUidLink('POINT001','POINT001').changes,{});
assert.deepEqual(planImportPointUidLink(null,'POINT001').changes,
  {place_id:'POINT001'});
assert.throws(()=>planImportPointUidLink(null,' POINT001'),/八碼 UID/);

const media=planImportMediaUidLinks(['MEDIA001'],new Set([
  'MEDIA001','MEDIA002','MEDIA003'
]));
assert.deepEqual(media.changes.media_link,['MEDIA001','MEDIA002','MEDIA003']);
assert.ok(media.patches.every(p=>p.path[0]==='media_link'));
assert.deepEqual(planImportMediaUidLinks(media.changes.media_link,['MEDIA002']).changes,{});

// A stored Point UID is authoritative even when articles have completely
// different original locations (including whitespace-only differences).
const index=createImportPlaceIndex();
index.accept({uid:'POINT001',type:'point',title:'',attr:{times:[]},createtime:null});
assert.equal(index.timesByUid.has('POINT001'),true);
assert.equal(index.existingByName.size,0);
const snapshot={scopeId:'mya',table:'silver.mya_anchor',place:index};
const places=await prepareImportPlaceAnchors([],{
  scopeId:'mya',anchorSnapshot:snapshot,
  relation:()=>{throw Error('Unexpected Point SELECT or INSERT')}
});
assert.equal(places.created,0);
assert.equal(places.table,'silver.mya_anchor');
assert.equal(places.timesByUid,index.timesByUid);
assert.equal(importedPlaceId({incoming:{location:'Another place'},
  existing:{place_id:'POINT001'},byName:places.byName}),null);

let writes=0,latest=null;
const relation=()=>({update:values=>{
  writes++;latest=values;
  const request={eq(){return request},select:async()=>({
    data:[{uid:'POINT001'}],error:null
  })};
  return request;
}});
const visits=[
  {uid:'POINT001',time:'2026-11-12T08:00:00Z'},
  {uid:'POINT001',time:'2026-11-14T08:00:00Z'}
];
const output=await recordImportPlaceVisits(visits,{
  relation,table:places.table,
  timesByUid:places.timesByUid,
  attrsByUid:places.attrsByUid,
  createtimeByUid:places.createtimeByUid
});
assert.equal(output.added,2);
assert.equal(output.updated,1);
assert.equal(writes,1);
assert.equal(latest.attr.times.length,2);
const repeat=await recordImportPlaceVisits(visits,{
  relation,table:places.table,
  timesByUid:places.timesByUid,
  attrsByUid:places.attrsByUid,
  createtimeByUid:places.createtimeByUid
});
assert.equal(repeat.added,0);
assert.equal(repeat.updated,0);
assert.equal(writes,1);
// Point import must never draft or mutate coordinate/alias payloads.
const originalPoint={longitude:121.0,latitude:25.0,location:'same place',
  times:['2026-11-12T08:00:00.000Z']};
const planned=planImportPointVisitDelta({uid:'POINT001',attr:originalPoint,
  createtime:'2026-11-12T08:00:00.000Z',
  visits:['2026-11-12T08:00:00Z','2026-11-14T08:00:00Z']});
assert.deepEqual(Object.keys(planned.changes),['times']);
assert.equal(planned.added,1);
assert.deepEqual(planned.changes.times,[
  '2026-11-12T08:00:00.000Z','2026-11-14T08:00:00.000Z']);
assert.equal(originalPoint.times.length,1);
assert.equal(originalPoint.location,'same place');
assert.deepEqual(planImportPointVisitDelta({uid:'POINT001',
  attr:{...originalPoint,times:planned.changes.times},
  createtime:'2026-11-12T08:00:00.000Z',
  visits:['2026-11-14T08:00:00Z']}).changes,{});
assert.deepEqual(planImportPointVisitDelta({uid:'POINT001',
  attr:{times:[]},createtime:null,visits:['2026-11-12T08:00:00Z']}).changes,{
  times:['2026-11-12T08:00:00.000Z'],createtime:'2026-11-12T08:00:00.000Z'
});
assert.throws(()=>planImportPointVisitDelta({
  uid:' POINT01',attr:{times:[]},visits:[]}),/UID/);

// CAS conflict: newer Point attr includes another writer's coordinate
// metadata. Recalculate from their latest row rather than stale attr.
const latestPoint={longitude:122,location:'another alias',
  times:['2026-11-13T08:00:00.000Z']};
let collisionCount=0,actualWritten=null;
const concurrentRelation=()=>({
  update:values=>{
    const request={eq(){return request},select:async()=>{
      collisionCount++;
      if(collisionCount===1)return {data:[],error:null};
      actualWritten=values;
      return {data:[{uid:'POINT001'}],error:null};
    }};return request;
  },
  select:()=>{const request={eq(){return request},maybeSingle:async()=>({
    data:{uid:'POINT001',attr:latestPoint,
      createtime:'2026-11-13T08:00:00.000Z'},error:null
  })};return request;}
});
const concurrentAttrs=new Map([['POINT001',originalPoint]]);
const concurrentTimes=new Map([['POINT001',originalPoint.times]]);
const concurrentCreated=new Map([['POINT001','2026-11-12T08:00:00.000Z']]);
const conflict=await recordImportPlaceVisits([
  {uid:'POINT001',time:'2026-11-14T08:00:00Z'}],{
  relation:concurrentRelation,table:'silver.mya_anchor',
  timesByUid:concurrentTimes,attrsByUid:concurrentAttrs,
  createtimeByUid:concurrentCreated
});
assert.equal(collisionCount,2);
assert.equal(conflict.updated,1);
assert.equal(conflict.added,1);
assert.equal(actualWritten.attr.longitude,122);
assert.equal(actualWritten.attr.location,'another alias');
assert.deepEqual(actualWritten.attr.times,[
  '2026-11-13T08:00:00.000Z','2026-11-14T08:00:00.000Z']);

// Date: only a date-title backfill emits a patch; authored metadata remains
// untouched and a second import is a no-op.
const day='2026-11-12';
const oldDate={uid:'DATE0001',type:'date',title:day,description:'',
  attr:{date:day}};
const dateEntry={date:day,title:'原文章',description:'重要大事：原文章'};
assert.deepEqual(planImportDateTitleDelta(oldDate,dateEntry,day).changes,{
  title:'原文章',description:'重要大事：原文章'
});
assert.equal(oldDate.title,day);
assert.deepEqual(planImportDateTitleDelta({...oldDate,title:'既有標題'},
  dateEntry,day).changes,{});
assert.deepEqual(planImportDateTitleDelta({...oldDate,description:'已整理'},
  dateEntry,day).patches,[]);
assert.throws(()=>planImportDateTitleDelta({...oldDate,uid:' DATE001'},
  dateEntry,day),/UID/);
const dateIndex=createImportDateIndex();
dateIndex.accept(oldDate);
let dateUpdates=0,dateCreates=0;
const dateTable={
  update:values=>{
    dateUpdates++;assert.deepEqual(values,{
      title:'原文章',description:'重要大事：原文章'
    });
    const request={eq(){return request},is(){return request},
      select:async()=>({data:[{uid:'DATE0001'}],error:null})};
    return request;
  },
  insert:()=>{dateCreates++;throw Error('Duplicate Date INSERT')}
};
const timeResult=await prepareImportTimeAnchors([{
  uid:'POST0001',title:'原文章',location:'原地點',
  createtime:'2026-11-12T08:00:00Z'
}],{
  scopeId:'mya',timeTable:'silver.mya_time',relation:()=>dateTable,
  anchorSnapshot:{scopeId:'mya',table:'silver.mya_anchor',time:dateIndex}
});
assert.equal(timeResult.created,0);
assert.equal(timeResult.reused,1);
assert.equal(timeResult.repaired,1);
assert.equal(dateUpdates,1);
assert.equal(dateCreates,0);
const insertedPoint=planImportPointCreate({
  uid:'POINT002',title:'原始地點',description:'{"text":""}',
  coordinates:[121.5,25.1],createtime:'2026-11-12T08:00:00.000Z'
});
assert.deepEqual(insertedPoint.row,{
  uid:'POINT002',type:'point',title:'原始地點',
  description:'{"text":""}',attr:{longitude:121.5,latitude:25.1},
  invisible:false,createtime:'2026-11-12T08:00:00.000Z'
});
assert.ok(insertedPoint.patches.length);
assert.deepEqual(planImportPointCreate({
  uid:'POINT003',title:'沒有座標',description:'{}'
}).row.attr,{});
assert.throws(()=>planImportPointCreate({
  uid:'POINT004',title:'不合法座標',coordinates:['121.5',25.1]
}),/座標/);
const insertedDate=planImportDateCreate({
  uid:'DATE0002',date:'2026-11-13',title:'次日',description:'重要大事：次日'
});
assert.deepEqual(insertedDate.row,{
  uid:'DATE0002',type:'date',attr:{date:'2026-11-13'},
  invisible:false,title:'次日',description:'重要大事：次日'
});
assert.ok(insertedDate.patches.length);
assert.throws(()=>planImportDateCreate({
  uid:'DATE0003',date:'Nov 13',title:'無效'
}),/日期/);
console.log('PASS: Immer Galaxy/Point/Date create/update, CAS retry and reimport idempotency');
