// Run after npm ci: node scripts/test-import-uid-immer.mjs
// No database, network or deployment. Exercises the real installed Immer.
import assert from 'node:assert/strict';
import {
  createImportUidResolver,remapImportUidRelations,
  planExistingImportUidUpdate,planImportMediaUidLinks
} from '../app/loc/import-uid-delta.mjs';
import {
  createImportPlaceIndex,prepareImportPlaceAnchors,
  importedPlaceId,recordImportPlaceVisits
} from '../app/loc/import-place-anchors.mjs';

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
console.log('PASS: Immer UID patches, exact PK, alias chain, merged Point visits and idempotency');
