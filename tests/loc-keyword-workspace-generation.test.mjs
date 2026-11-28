import {withKeywordScope} from '../app/loc/actions/keywords/context.mjs';
import {setKeywordClassShare} from '../app/loc/keywords/sql-service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {bumpKeywordClassEpoch} from '../app/loc/keywords/class-state.mjs';
import {writeKeywordScanProgress} from '../app/loc/keywords/class-state.mjs';
import {invalidateKeywordClass} from '../app/loc/keywords/class-state.mjs';
import {analyzeKeywordScope} from '../app/loc/keywords/sql-service.mjs';
import {readKeywordStatistics} from '../app/loc/keywords/sql-service.mjs';

{
const first='AAAA0001',second='BBBB0002';
test('Keyword clear removes the interrupted cursor and Pattern totals together',()=>{
  // Clearing a Class must not invalidate a neighboring Class receipt.
  const progress={by_class:{[first]:{completedAt:'yes'},[second]:{completedAt:'still'}},
    scan_progress:{[first]:{scanned:32768,patternCounts:{PATT0001:92}},
      [second]:{scanned:4096}},analysis_epochs:{[first]:9,[second]:4}};
  const after=bumpKeywordClassEpoch(
    writeKeywordScanProgress(invalidateKeywordClass(progress,first),first,null),first);
  assert.equal(after.scan_progress[first],undefined);
  assert.equal(after.by_class[first],undefined);
  assert.equal(after.analysis_epochs[first],10);
  assert.equal(after.scan_progress[second].scanned,4096);
  assert.equal(after.by_class[second].completedAt,'still');
});
}

{
const CLASS='CLASS001';

function staleJobDatabase(){
  const calls=[];
  const config={
    keyword_meta:{analysis_epochs:{[CLASS]:12},
      scan_progress:{[CLASS]:{scanned:4096,cursor:{phase:'dated',
        lastDate:'2026-11-01',lastUid:'ABCDEFGH'}}}},
    keyword_min_chars:0,keyword_min_documents:1
  };
  const root={uid:CLASS,type:'class',title:'Words',description:'',attr:{uid:[]}};
  const db={
    selectFrom(table){
      calls.push(table);
      if(table!=='silver.lo3rwang'&&table!=='silver.lo3rwang_lucus')
        throw new Error('A stale run must never touch Galaxy');
      const query={
        select(){return query},
        where(){return query},
        async executeTakeFirst(){
          return table==='silver.lo3rwang'?config:root;
        }
      };
      return query;
    }
  };
  return {db,calls,config};
}

test('new analysis cannot reuse an older generation after a reset',async()=>{
  const {db,calls}=staleJobDatabase();
  await assert.rejects(analyzeKeywordScope(db,'lo3rwang',CLASS,{
    analysisEpoch:11
  }),/舊分析工作階段已失效/);
  assert.deepEqual(calls,['silver.lo3rwang','silver.lo3rwang_lucus']);
});

}

{
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
      if(table!=='silver.lo3rwang_lucus'&&table!=='silver.lo3rwang')
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



}

test('keyword sharing uses one locked read-modify-write transaction and fails closed',async()=>{
  let metadata={class_shares:{ABCD1234:false},other:{unrelated:true}};
  const events=[];
  const db={transaction:()=>({execute:async work=>{
    events.push('begin');
    const original=structuredClone(metadata);
    const trx={
      selectFrom(table){
        assert.equal(table,'silver.lo3rwang');
        return {select(field){
          assert.equal(field,'keyword_meta');
          return {where(column,op,value){
            assert.deepEqual([column,op,value],['id','=','lo3rwang']);
            return {forUpdate(){events.push('lock');return {
              executeTakeFirst:async()=>({keyword_meta:metadata})
            };}};
          }};
        }};
      },
      updateTable(table){
        assert.equal(table,'silver.lo3rwang');
        return {set(values){
          return {where(column,op,value){
            assert.deepEqual([column,op,value],['id','=','lo3rwang']);
            return {executeTakeFirst:async()=>{
              events.push('update');metadata=JSON.parse(values.keyword_meta);
              return {numUpdatedRows:1n};
            }};
          }};
        }};
      }
    };
    try{const out=await work(trx);events.push('commit');return out;}
    catch(error){metadata=original;events.push('rollback');throw error;}
  }})};
  const rights=async()=>{events.push('authorize');};
  const result=await setKeywordClassShare(db,'lo3rwang','ABCD1234',true,{
    authorizeTransaction:rights
  });
  assert.equal(result.keyword_meta.class_shares.ABCD1234,true);
  assert.deepEqual(metadata.other,{unrelated:true});
  assert.deepEqual(events,['begin','authorize','lock','update','commit']);
  events.length=0;
  await assert.rejects(setKeywordClassShare(db,'lo3rwang','ABCD1234',false,{
    authorizeTransaction:async()=>{throw Error('Scope denied');}
  }),/Scope denied/);
  assert.equal(metadata.class_shares.ABCD1234,true);
  assert.deepEqual(events,['begin','rollback']);
});

test('Keyword read and write actions reject missing grants before opening SQL',async()=>{
  for(const write of [false,true]){
    let connected=0,ran=0;
    const dependencies={
      getHeaders:async()=>new Headers({cookie:'loc_session=opaque'}),
      verifySession:async()=>({userId:'USER_NO_SCOPE',email:'ungranted@example.org'}),
      openDatabase:async()=>{connected++;throw Error('SQL must stay closed');},
      closeDatabase:async()=>{}
    };
    await assert.rejects(withKeywordScope('lo3rwang',{write},async()=>{ran++;},dependencies),
      error=>error.httpStatus===403);
    assert.equal(connected,0);
    assert.equal(ran,0);
  }
});
