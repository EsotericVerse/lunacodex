import test from 'node:test';
import assert from 'node:assert/strict';
import {readKeywordWorkspace} from '../app/loc/keywords/sql-service.mjs';
import {keywordClassEpoch} from '../app/loc/keywords/class-state.mjs';
import {bumpKeywordClassEpoch} from '../app/loc/keywords/class-state.mjs';
import {writeKeywordScanProgress} from '../app/loc/keywords/class-state.mjs';
import {invalidateKeywordClass} from '../app/loc/keywords/class-state.mjs';
import {analyzeKeywordScope} from '../app/loc/keywords/sql-service.mjs';
import {readKeywordStatistics} from '../app/loc/keywords/sql-service.mjs';
import {readKeywordCatalog} from '../app/loc/keywords/sql-service.mjs';
import {readKeywordDaily} from '../app/loc/keywords/sql-service.mjs';

{
const first='AAAA0001',second='BBBB0002';
test('Keyword class Reset increments only its own generation',()=>{
  const meta={by_class:{[first]:{completedAt:'2026-01-01'}},
    scan_progress:{[first]:{cursor:'X'}},analysis_epochs:{[first]:3,[second]:8}};
  const cleared=bumpKeywordClassEpoch(
    writeKeywordScanProgress(invalidateKeywordClass(meta,first),first,null),first);
  assert.equal(keywordClassEpoch(cleared,first),4);
  assert.equal(keywordClassEpoch(cleared,second),8);
  assert.equal(cleared.by_class[first],undefined);
  assert.equal(cleared.scan_progress[first],undefined);
  assert.equal(keywordClassEpoch({},first),0);
});
test('Keyword workspace reads fixed UID-ordered Anchor and Scope config',async()=>{
  const used={tables:[],limits:[],where:[],sort:[]};
  const records=[{uid:'AAAA0001',type:'category',title:'Category',description:'',
    attr:{uid:['BBBB0002']}}];
  const query=(table)=>({
    select(){return this},
    where(...args){used.where.push(args);return this},
    orderBy(...args){used.sort.push(args);return this},
    limit(n){used.limits.push(n);return this},
    async execute(){return records},
    async executeTakeFirst(){return {current_keyword_class_uid:'BBBB0002',
      keyword_meta:{},keyword_min_chars:2,keyword_min_documents:1}}
  });
  const trx={selectFrom(table){used.tables.push(table);return query(table)}};
  const res=await readKeywordWorkspace(trx,'lo3rwang',{limit:250});
  assert.deepEqual(res.rows,records);
  assert.equal(res.config.current_keyword_class_uid,'BBBB0002');
  assert.equal(res.nextCursor,null);
  assert.deepEqual(used.tables,['silver.lo3rwang_anchor','silver.lo3rwang']);
  assert.deepEqual(used.limits,[251]);
  assert.ok(used.where.some(v=>v[0]==='type'&&v[1]==='in'));
  await assert.rejects(readKeywordWorkspace(trx,'lo3rwang',{limit:500}),
    /Invalid Keyword editor page size/);
});

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
      if(table!=='silver.lo3rwang'&&table!=='silver.lo3rwang_anchor')
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
  assert.deepEqual(calls,['silver.lo3rwang','silver.lo3rwang_anchor']);
});

test('new analysis refuses tokenless or invalid reset generations',async()=>{
  for(const epoch of [undefined,0,-1,1.5,'12',null]){
    const {db,calls}=staleJobDatabase();
    await assert.rejects(analyzeKeywordScope(db,'lo3rwang',CLASS,{
      analysisEpoch:epoch
    }),/confirmed reset generation/);
    assert.equal(calls.length,0);
  }
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



test('Catalog also reflects zero without dropping the Keyword structure',async()=>{
  const db=clearedDatabase();
  const catalog=await readKeywordCatalog(db,'lo3rwang',cls,{owner:true});
  assert.deepEqual(catalog.rows.map(x=>x.uid),[cls,group,item]);
  assert.deepEqual(catalog.rows.map(x=>x.total),[0,0,0]);
});

test('Daily chart stays empty after clear and performs no article read',async()=>{
  const db=clearedDatabase();
  const rows=await readKeywordDaily(db,'lo3rwang',cls,{
    owner:true,start:'2026-01-01',end:'2026-12-31'
  });
  assert.deepEqual(rows,[]);
  assert.deepEqual(db.queried,['silver.lo3rwang']);
});
}
