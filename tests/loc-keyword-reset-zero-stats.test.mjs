import test from 'node:test';
import assert from 'node:assert/strict';
import {readKeywordStatistics,readKeywordCatalog}
  from '../app/loc/keywords/sql-service.mjs';
import {readKeywordScanProgress,keywordClassEpoch,bumpKeywordClassEpoch,
  invalidateKeywordClass,writeKeywordScanProgress}
  from '../app/loc/keywords/class-state.mjs';

const cls='CLAS0001',group='GRUP0001',item='ITEM0001';
const node=(uid,type,title,ids=[])=>({
  uid,type,title,description:'',attr:{uid:ids,total:77}
});

function clearedDatabase(){
  const queried=[];
  const rows=[
    node(cls,'class','Class A',[group]),
    node(group,'group','Group A',[item]),
    node(item,'item','Item A')
  ];
  const cfg={id:'lo3rwang',keyword_meta:{analysis_epochs:{[cls]:3}},
    keyword_min_chars:0,keyword_min_documents:0};
  return {
    queried,
    selectFrom(table){
      queried.push(table);
      // The three structural reads are enough for a cleared Class.
      if(table!=='silver.lo3rwang_anchor'&&table!=='silver.lo3rwang')
        throw Error('Reset statistics unexpectedly scanned Galaxy');
      const filters=[];
      const builder={
        select(){return builder},
        where(field,op,value){filters.push({field,op,value});return builder},
        async executeTakeFirst(){
          if(table==='silver.lo3rwang')return cfg;
          return rows.find(row=>filters.every(f=>
            f.field==='uid'?row.uid===f.value:
              f.field==='type'?row.type===f.value:true))||null;
        },
        async execute(){
          if(table==='silver.lo3rwang')return [cfg];
          return rows.filter(row=>filters.every(f=>
            f.field==='uid'?f.op==='in'?f.value.includes(row.uid):row.uid===f.value:
              f.field==='type'?f.op==='in'?f.value.includes(row.type):row.type===f.value:true));
        }
      };
      return builder;
    }
  };
}

test('after a cleared Class, unfiltered stats are zero despite old Anchor total',async()=>{
  const db=clearedDatabase();
  const result=await readKeywordStatistics(db,'lo3rwang',cls,{owner:true});
  assert.equal(result.indexPending,true);
  assert.equal(result.completedAt,'');
  assert.equal(result.total_hits,0);
  assert.equal(result.document_count,0);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].uid,item);
  assert.equal(result.items[0].hit_count,0);
  assert.equal(result.groups[0].hit_count,0);
  assert.ok(db.queried.every(t=>t!=='silver.lo3rwang_galaxy'));
});

test('after a cleared Class, date/source filters cannot silently recompute hits',async()=>{
  for(const filter of [{start:'2026-01-01',end:'2026-12-31'},
    {source:'Facebook'},{start:'2026-01-01',source:'Threads'}]){
    const db=clearedDatabase();
    const stats=await readKeywordStatistics(db,'lo3rwang',cls,{owner:true,...filter});
    assert.equal(stats.total_hits,0);
    assert.equal(stats.document_count,0);
    assert.equal(stats.indexPending,true);
    assert.deepEqual(stats.daily,[]);
    assert.ok(db.queried.every(t=>t!=='silver.lo3rwang_galaxy'));
  }
});

test('clearing does not delete Keyword IDs; it deletes resumed UID cursor',()=>{
  const meta={by_class:{[cls]:{completedAt:'y'}},
    scan_progress:{[cls]:{cursor:{lastUid:'AAAA0001',lastDate:'2026-01-01'},
      scanned:8192}},analysis_epochs:{[cls]:8}};
  const clear=bumpKeywordClassEpoch(
    writeKeywordScanProgress(invalidateKeywordClass(meta,cls),cls,null),cls);
  assert.equal(readKeywordScanProgress(clear,cls),null);
  assert.equal(clear.by_class[cls],undefined);
  assert.equal(keywordClassEpoch(clear,cls),9);
  // Class UID is the key of the cancellation generation, not the last
  // article scanned. This guard prevents an interrupted scan from writing.
  assert.equal(Object.hasOwn(clear.analysis_epochs,cls),true);
});

test('Catalog also reflects zero without dropping the Keyword structure',async()=>{
  const db=clearedDatabase();
  const catalog=await readKeywordCatalog(db,'lo3rwang',cls,{owner:true});
  assert.deepEqual(catalog.rows.map(x=>x.uid),[cls,group,item]);
  assert.deepEqual(catalog.rows.map(x=>x.total),[0,0,0]);
});
