import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeIncrementalKeywordPatterns} from '../app/loc/keyword-incremental.mjs';
import {keywordPatternDailySummary,keywordPatternItemMetrics} from '../app/loc/keyword-search-pattern.mjs';
import {createKeywordUidDocumentClassifier} from '../app/loc/model/keyword-uid-analysis.mjs';

const tree=[
  {uid:'CAT00001',type:'category',name:'類',lists:['CL000001'],uid_lists:[]},
  {uid:'CL000001',type:'class',name:'分類',lists:['GR000001'],uid_lists:[]},
  {uid:'GR000001',type:'group',name:'群組',lists:['IT000001'],uid_lists:[]},
  {uid:'IT000001',type:'item',name:'水',lists:['火'],uid_lists:[]}
];
const oldItem={uid:'IT000001',item_name:'水',keywords:['火'],group_uid:'GR000001'};
const itemWithNewTitle={uid:'IT000001',item_name:'水火',keywords:['水','火'],group_uid:'GR000001'};
const ts='2026-11-01T00:00:00.000Z';
const docs=[
  {uid:'Ab000001',date:'2026-11-01',createtime:ts,
    UpdateTime:ts,keyword:true,content:'清水'},
  {uid:'Ab000002',date:'2026-11-01',createtime:ts,
    UpdateTime:ts,keyword:true,content:'烈火'}
];
const rowByWord=(patterns,word)=>patterns.find(row=>row.pattern===word);

async function run({documents=docs,items=[oldItem],existingPatterns=[],
  patternScans={},startedAt='2026-11-07T00:00:00.000Z',
  failWrite=false}={}){
  let contentReads=0,saved=null,finalized=null;
  const result=await analyzeIncrementalKeywordPatterns({
    scopeId:'lo3rwang',classUid:'CL000001',treeRows:tree,items,
    existingPatterns,patternScans,startedAt,minChars:0,
    pageSize:1,expectedCount:documents.length,
    readMetadataPage:async({offset,limit})=>documents.slice(offset,offset+limit)
      .map(({content,...row})=>row),
    readContent:async uids=>{
      contentReads+=uids.length;
      return uids.map(uid=>documents.find(row=>row.uid===uid))
        .map(({date,createtime,UpdateTime,...row})=>row);
    },
    writePatterns:async({patterns})=>{
      if(failWrite)throw Error('forced write failure');
      saved=patterns;
    },
    finalize:async value=>{finalized=value;}
  });
  return {result,contentReads,saved,finalized};
}

test('first scan creates a word row once; next scan reads no unchanged bodies',async()=>{
  const first=await run();
  assert.equal(first.contentReads,2);
  assert.deepEqual(rowByWord(first.saved,'水').uid_list,['Ab000001']);
  assert.deepEqual(rowByWord(first.saved,'火').uid_list,['Ab000002']);
  const second=await run({
    existingPatterns:first.saved,patternScans:first.result.patternScans,
    startedAt:'2026-11-07T01:00:00.000Z'
  });
  assert.equal(second.contentReads,0);
  assert.equal(second.result.parsedDocuments,0);
  assert.equal(second.result.reusedDocuments,2);
  assert.deepEqual(second.saved,first.saved);
});

test('modified article changes only its previously parsed UID membership',async()=>{
  const first=await run();
  const revised=docs.map(row=>row.uid==='Ab000002'
    ?{...row,content:'水流',UpdateTime:'2026-11-07T02:00:00Z'}:row);
  const next=await run({documents:revised,existingPatterns:first.saved,
    patternScans:first.result.patternScans,
    startedAt:'2026-11-07T03:00:00Z'});
  assert.equal(next.contentReads,1);
  assert.deepEqual(rowByWord(next.saved,'水').uid_list,['Ab000001','Ab000002']);
  assert.deepEqual(rowByWord(next.saved,'火').uid_list,[]);
});

test('new Item reuses 水/火 and analyzes only new literal 水火',async()=>{
  const first=await run();
  const replay=await run({items:[itemWithNewTitle],
    existingPatterns:first.saved,patternScans:first.result.patternScans,
    startedAt:'2026-11-07T03:00:00Z'});
  assert.deepEqual(rowByWord(replay.saved,'水').uid_list,['Ab000001']);
  assert.deepEqual(rowByWord(replay.saved,'火').uid_list,['Ab000002']);
  assert.equal(rowByWord(replay.saved,'水火').count,0);
  const result=keywordPatternItemMetrics([itemWithNewTitle],replay.saved);
  assert.equal(result.items[0].hit_count,2);
  assert.equal(result.items[0].document_count,2);
});

test('excluded and deleted articles remove stale hits without any content read',async()=>{
  const first=await run();
  const removed=await run({documents:[{...docs[0],keyword:false,
    UpdateTime:'2026-11-07T02:00:00Z'}],existingPatterns:first.saved,
    patternScans:first.result.patternScans,
    startedAt:'2026-11-07T03:00:00Z'});
  assert.equal(removed.contentReads,0);
  assert.deepEqual(rowByWord(removed.saved,'水').uid_list,[]);
  assert.deepEqual(rowByWord(removed.saved,'火').uid_list,[]);
});

test('failed index write never marks analysis complete',async()=>{
  await assert.rejects(()=>run({failWrite:true}),/forced write failure/);
});

test('word-only classifier ignores previously processed words',()=>{
  const classify=createKeywordUidDocumentClassifier(tree,'CL000001',{
    collectKeywordTerms:true,selectedTerms:new Set(['火'])
  });
  const result=classify([{uid:'Ab000001',content:'水火'}]);
  assert.deepEqual(result.classifications[0].matched_terms,['火']);
});

test('dated counts derive from word UIDs, not Anchor totals',()=>{
  const patterns=[
    {pattern:'水',count:2,uid_list:['Ab000001','Ab000002']},
    {pattern:'火',count:2,uid_list:['Ab000002','Ab000003']}
  ];
  const articles=[
    {uid:'Ab000001',date:'2026-11-01'},
    {uid:'Ab000002',date:'2026-11-02'},
    {uid:'Ab000003',date:'2026-11-02'}
  ];
  const rows=keywordPatternDailySummary([itemWithNewTitle],patterns,articles);
  assert.equal(rows.find(row=>row.kind==='eligible').document_count,3);
  assert.equal(rows.find(row=>row.kind==='item').hit_count,4);
  assert.deepEqual(rows.filter(row=>row.kind==='item_day')
    .map(row=>[row.day,row.hit_count,row.document_count])
    .sort(),[['2026-11-01',1,1],['2026-11-02',3,2]]);
  const limited=keywordPatternItemMetrics([itemWithNewTitle],patterns,{
    articleUids:new Set(['Ab000002'])
  });
  assert.equal(limited.items[0].hit_count,2);
  assert.equal(limited.items[0].document_count,1);
});

test('unchanged bulk Galaxy metadata skips every content read after completed scans',async()=>{
  const many=Array.from({length:250},(_,index)=>({
    uid:'Kw'+String(index).padStart(6,'0'),date:'2026-11-01',
    createtime:ts,UpdateTime:ts,keyword:true,content:'清水烈火'
  }));
  const first=await run({documents:many});
  assert.equal(first.contentReads,250);
  const second=await run({
    documents:many,existingPatterns:first.saved,
    patternScans:first.result.patternScans,
    startedAt:'2026-11-07T01:00:00Z'
  });
  assert.equal(second.contentReads,0);
  assert.equal(second.result.reusedDocuments,250);
  assert.deepEqual(second.saved,first.saved);
});

test('Aho-Corasick candidate filter retains Item NOR exclusions and unmatched documents',()=>{
  const rows=[
    {uid:'CAT00001',type:'category',name:'所有詞',lists:['CL000001']},
    {uid:'CL000001',type:'class',name:'主分類',lists:['GR000001']},
    {uid:'GR000001',type:'group',name:'文化',lists:['IT000001']},
    {uid:'IT000001',type:'item',name:'城市',lists:['星光','星光NOR月亮']}
  ];
  const classify=createKeywordUidDocumentClassifier(rows,'CL000001',{
    collectKeywordTerms:true,selectedTerms:new Set(['城市','星光'])
  });
  const result=classify([
    {uid:'Ab000001',content:'城市星光月亮'},
    {uid:'Ab000002',content:'星光'},
    {uid:'Ab000003',content:'未命中的日常生活'},
    {uid:'Ab000004',content:'星光月亮'}
  ]);
  assert.deepEqual(result.classifications.map(row=>row.matched_terms),[
    ['城市'],['星光'],[],[]
  ]);
  assert.deepEqual(result.classifications.map(row=>row.hits.reduce(
    (sum,hit)=>sum+hit.times,0)),[1,1,0,0]);
});

test('NAME replacement can create a spaced literal and must not be lost by Aho prefilter',()=>{
  const rows=[
    {uid:'CAT00001',type:'category',name:'類',lists:['CL000001']},
    {uid:'CL000001',type:'class',name:'分類',lists:['GR000001','GR000002']},
    {uid:'GR000001',type:'group',name:'城市',lists:['IT000001']},
    {uid:'GR000002',type:'group',name:'資訊',lists:['IT000002']},
    {uid:'IT000001',type:'item',name:'城市',lists:['dark jazz']},
    {uid:'IT000002',type:'item',name:'資訊',lists:['noiseNAME']}
  ];
  const classify=createKeywordUidDocumentClassifier(rows,'CL000001',{
    collectKeywordTerms:true,selectedTerms:new Set(['dark jazz'])
  });
  const docs=[
    {uid:'Ab000001',content:'darknoisejazz'},
    {uid:'Ab000002',content:'dark jazz'},
    {uid:'Ab000003',content:'without any matching word'}
  ];
  const result=classify(docs);
  assert.deepEqual(result.classifications.map(row=>row.matched_terms),
    [['dark jazz'],['dark jazz'],[]]);
  assert.deepEqual(result.classifications.map(row=>row.hits.reduce(
    (sum,hit)=>sum+hit.times,0)),[1,1,0]);
});
