import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {planUidDependencyRepair} from '../app/loc/uid-dependency-immer.mjs';
import {repairBeforeUidDelete} from '../app/loc/providers/uid-dependency-before-delete.mjs';

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

test('Point delete refuses to leave a one-point Path or empty Trace',()=>{
  const shortPath={uid:'PATH0001',type:'path',attr:{point:['DELET001','POINT002']}};
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'point',anchorRows:[shortPath]}),/Path/);
  const loneTrace={uid:'TRAC0001',type:'trace',
    attr:{point:['DELET001','POINT002'],path:[]}};
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'point',anchorRows:[loneTrace]}),/Trace/);
  const routedTrace={uid:'TRAC0001',type:'trace',
    attr:{point:['DELET001','POINT002'],path:['PATH0001']}};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'point',anchorRows:[routedTrace]});
  assert.deepEqual(plan.anchorUpdates[0].values.attr.point,[]);
  assert.deepEqual(plan.anchorUpdates[0].values.attr.path,['PATH0001']);
});

test('Deletion refuses to leave empty Period, Era or route-only Trace',()=>{
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,
    deletedTable:'anchor',deletedType:'date',
    anchorRows:[{uid:'PERI0001',type:'period',attr:{uid:[deleted]}}]}),/Period/);
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,
    deletedTable:'anchor',deletedType:'period',
    anchorRows:[{uid:'ERAA0001',type:'era',attr:{period:[deleted]}}]}),/Era/);
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,
    deletedTable:'anchor',deletedType:'path',
    anchorRows:[{uid:'TRAC0001',type:'trace',attr:{path:[deleted],point:[]}}]}),/Trace/);
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

test('Portable SQL JSON strings use exact UID membership, not text substring',()=>{
  const row={uid:article,source_id:null,ref_id:null,
    target_id:JSON.stringify([deleted,'ARTI0002'])};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'galaxy',
    galaxyRows:[row]});
  assert.equal(plan.affected,1);
  assert.deepEqual(plan.galaxyUpdates[0].values.target_id,['ARTI0002']);
  assert.equal(plan.galaxyUpdates[0].expected.target_id,row.target_id);
  assert.throws(()=>planUidDependencyRepair({deletedUid:deleted,deletedTable:'galaxy',
    galaxyRows:[{uid:article,target_id:'invalid JSON'}]}));
});

test('Source Anchor deletion fixes parent UID list but never edits site literals',()=>{
  const node={uid:'DOMA0001',type:'domain',attr:{uid:[deleted,'FROM0002'],counts:{lrunes:3}}};
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'from',anchorRows:[node],
    galaxyRows:[{uid:article,site:'Original source literal',site_id:'external-post-123'}]});
  assert.equal(plan.affected,1);
  assert.deepEqual(plan.anchorUpdates[0].values.attr.uid,['FROM0002']);
  assert.deepEqual(plan.anchorUpdates[0].values.attr.counts,{lrunes:3});
  assert.deepEqual(plan.galaxyUpdates,[]);
});

test('Deleting an unrelated Anchor does not alter Galaxy article values',()=>{
  const plan=planUidDependencyRepair({deletedUid:deleted,deletedTable:'anchor',
    deletedType:'date',galaxyRows:[{uid:article,date:'2026-11-14',
    location:'Sample location',site:'Sample source'}]});
  assert.equal(plan.affected,0);
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

// The real Immer module is used here; SQL is intentionally replaced by a
// recording query interface so these tests cannot mutate the live database.
function recordingKysely({anchorTarget,galaxyCandidates=[],anchorCandidates=[]}={}){
  const events=[];
  function selectFrom(table){
    const query={table,conditions:[],columns:[],
      select(cols){this.columns=cols;return this;},
      where(...args){
        if(typeof args[0]==='function'){
          const eb=(...parts)=>({parts});
          eb.or=items=>({or:items});eb.and=items=>({and:items});
          this.conditions.push(args[0](eb));
        }else this.conditions.push(args);
        return this;
      },
      async executeTakeFirst(){
        events.push({kind:'select',table,columns:this.columns,conditions:this.conditions});
        return anchorTarget;
      },
      async execute(){
        if(!this.conditions.length)throw Error('Unbounded UID dependency SELECT');
        events.push({kind:'select',table,columns:this.columns,conditions:this.conditions});
        return this.columns.includes('type')?anchorCandidates:galaxyCandidates;
      }
    };
    return query;
  }
  function updateTable(table){
    return {
      set(values){this.values=values;this.conditions=[];return this;},
      where(...args){this.conditions.push(args);return this;},
      async executeTakeFirst(){
        if(!this.conditions.some(args=>args[0]==='uid'))throw Error('Update without UID PK');
        events.push({kind:'update',table,values:this.values,conditions:this.conditions});
        return {numUpdatedRows:1n};
      }
    };
  }
  return {db:{selectFrom,updateTable},events};
}

test('Before-delete flow reads matching UID references then updates only dependents',async()=>{
  const {db,events}=recordingKysely({
    anchorTarget:{uid:deleted,type:'point'},
    galaxyCandidates:[{uid:article,place_id:deleted}],
    anchorCandidates:[{uid:'PATH0001',type:'path',attr:{point:[deleted,'POINT002','POINT003']}}]
  });
  const outcome=await repairBeforeUidDelete(db,{
    table:'lo3rwang_anchor',filters:[{column:'uid',operator:'eq',value:deleted}]
  });
  assert.equal(outcome.affected,2);
  assert.deepEqual(events.map(e=>e.kind),['select','select','select','update','update']);
  assert.ok(events.filter(e=>e.kind==='select').every(e=>e.conditions.length));
  assert.ok(events.filter(e=>e.kind==='update').every(e=>
    e.conditions.some(args=>args[0]==='uid')));
});

test('Broad deletes are rejected before any dependency SQL read',async()=>{
  const {db,events}=recordingKysely();
  await assert.rejects(repairBeforeUidDelete(db,{table:'lo3rwang_galaxy',
    filters:[{column:'type',operator:'eq',value:'galaxy'}]}));
  assert.deepEqual(events,[]);
});
