import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {planUidDependencyRepair} from '../app/loc/uid-dependency-immer.mjs';

const deleted='DELET001';
const article='ARTI0001';
const unchanged='ARTI0002';
const pattern='PATT0001';

test('MediaAnchor deletion only removes its exact UID from media_link',()=>{
  const before={uid:article,media_link:['DELET001','MEDIA002'],
    location:'原始地址',site:'網站',date:'2026-11-14',place_id:'POINT001'};
  const safe={uid:unchanged,media_link:['MEDIA002']};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'image',galaxyRows:[before,safe]});
  assert.equal(plan.affected,1);
  assert.deepEqual(plan.galaxyUpdates[0].values,{media_link:['MEDIA002']});
  assert.deepEqual(before.media_link,['DELET001','MEDIA002']);
  assert.equal(plan.anchorUpdates.length,0);
});

test('Point deletion clears only place_id, preserving provenance fields',()=>{
  const row={uid:article,place_id:deleted,location:'台北市',
    site:'來源名稱',date:'2026-11-14',media_link:['MEDIA002']};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'point',galaxyRows:[row]});
  assert.deepEqual(plan.galaxyUpdates[0].values,{place_id:null});
  assert.equal(row.place_id,deleted);
  assert.equal(row.location,'台北市');
});

test('Deleting a Date changes only matching Period UID endpoints',()=>{
  const current={uid:'PERI0001',type:'period',
    attr:{uid:['DELET001','DATE0002'],date:['2026-11-13']}};
  const unaffected={uid:'ERAA0001',type:'era',attr:{period:['PERI0001']}};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'date',anchorRows:[current,unaffected]});
  assert.equal(plan.anchorUpdates.length,1);
  assert.deepEqual(plan.anchorUpdates[0].values.attr.uid,['DATE0002']);
  assert.deepEqual(current.attr.uid,['DELET001','DATE0002']);
});

test('Trace point pairs are removed as segments, not reconnected',()=>{
  const trace={uid:'TRAC0001',type:'trace',
    attr:{point:['DELET001','POINT002','POINT003','POINT004'],path:['PATH0001']}};
  const path={uid:'PATH0001',type:'path',
    attr:{point:['POINT005','DELET001','POINT006']}};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'point',anchorRows:[trace,path]});
  assert.equal(plan.anchorUpdates.length,2);
  const byId=new Map(plan.anchorUpdates.map(row=>[row.uid,row.values.attr]));
  assert.deepEqual(byId.get('TRAC0001').point,['POINT003','POINT004']);
  assert.deepEqual(byId.get('PATH0001').point,['POINT005','POINT006']);
  assert.deepEqual(trace.attr.point,['DELET001','POINT002','POINT003','POINT004']);
});

test('Article deletion corrects relation fields and Pattern postings',()=>{
  const linked={uid:article,source_id:deleted,ref_id:deleted,
    target_id:[deleted,'ARTI0002']};
  const unchangedRow={uid:unchanged,source_id:null,ref_id:null,target_id:[]};
  const p={uid:pattern,type:'pattern',attr:{'63ade525':[deleted,'ARTI0002'],other:true},num:2n};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'galaxy',
    galaxyRows:[linked,unchangedRow],anchorRows:[p]});
  assert.equal(plan.affected,2);
  assert.deepEqual(plan.galaxyUpdates[0].values,
    {source_id:null,target_id:['ARTI0002'],ref_id:null});
  assert.deepEqual(plan.anchorUpdates[0].values.attr['63ade525'],['ARTI0002']);
  assert.equal(plan.anchorUpdates[0].values.num,1n);
  assert.deepEqual(p.attr['63ade525'],[deleted,'ARTI0002']);
});

test('No-op plans do not produce SQL updates',()=>{
  const row={uid:article,media_link:['MEDIA002']};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'image',galaxyRows:[row]});
  assert.equal(plan.affected,0);
  assert.deepEqual(plan.galaxyUpdates,[]);
  assert.deepEqual(plan.anchorUpdates,[]);
});

test('Malformed UID or mismatched data fails closed',()=>{
  assert.throws(()=>planUidDependencyRepair({deletedUid:'bad',deletedTable:'galaxy'}));
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'point',anchorRows:[{uid:'TRAC0001',type:'trace',
      attr:{point:['DELET001','POINT002','POINT003']}}]}));
});

test('Benchmarks the in-memory plan independently of SQL/network (non-gating)',()=>{
  const rows=Array.from({length:500},(_,i)=>({uid:'A'+String(i).padStart(7,'0'),
    media_link:i===240?[deleted,'MEDIA002']:['MEDIA002']}));
  const before=performance.now();
  let plan;
  for(let i=0;i<50;i++)plan=planUidDependencyRepair({
    deletedUid:deleted,deletedTable:'anchor',deletedType:'image',galaxyRows:rows});
  const elapsed=performance.now()-before;
  assert.equal(plan.affected,1);
  console.log('UID dependency Immer 500 rows × 50 runs: '+elapsed.toFixed(2)+' ms total / '+
    (elapsed/50).toFixed(3)+' ms per planning run (SQL excluded)');
});
