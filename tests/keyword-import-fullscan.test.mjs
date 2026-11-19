import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';
import {analyzeIncrementalKeywordPatterns} from '../app/loc/keywords/incremental.mjs';
import {dedupeIncomingImport} from '../app/loc/import/duplicate-check.mjs';

test('discovery retains single-use terms and question punctuation without weighting',()=>{
  const discovery=createNewKeywordDiscovery([]);
  discovery.consume([{uid:'GALA0001',title:'月光',content:'我很好？'},
    {uid:'GALA0002',title:'標題',content:'我很好！'}]);
  const results=discovery.finish();
  const words=new Set(results.candidates.map(row=>row.word));
  assert.equal(results.read,2);
  assert.ok(words.has('?'));
  assert.ok(words.has('!'));
  assert.ok(words.has('月光'));
  assert.ok(words.has('？'.normalize('NFKC')));
  assert.equal(results.candidates.some(row=>row.documents===1),true);
  assert.ok(results.candidates.every(row=>!Object.hasOwn(row,'score')));
});

test('import keeps punctuation differences and separate posts without native IDs',()=>{
  const make=(uid,content)=>({
    uid,site:'Threads',createtime:'2026-11-20T00:00:00.000Z',
    title:'測試',content
  });
  const {unique,duplicates}=dedupeIncomingImport([
    make('GALA0001','我很好？'),
    make('GALA0002','我很好！'),
    make('GALA0003','我很好？')
  ]);
  assert.equal(duplicates,0);
  assert.deepEqual(unique.map(row=>row.uid),['GALA0001','GALA0002','GALA0003']);
});

test('full scan emits one Pattern batch only after all Galaxy UIDs are read',async()=>{
  const pages=[{rows:[
    {uid:'GALA0001',keyword:true,UpdateTime:'2000-01-01T00:00:00Z'},
    {uid:'GALA0002',keyword:true,UpdateTime:'2026-11-20T00:00:00Z'}
  ],nextCursor:'end'},{rows:[],nextCursor:null}];
  const articles=[
    {uid:'GALA0001',title:'月光',content:'今天如何？',keyword:true},
    {uid:'GALA0002',title:'晴朗',content:'我很好！',keyword:true}
  ];
  let cursor=0;
  let writeCalls=0,finished=false;
  const result=await analyzeIncrementalKeywordPatterns({
    scopeId:'loc',classUid:'CLASS001',
    existingPatterns:[
      {uid:'PTNR0001',pattern:'月光',uid_list:[],count:0},
      {uid:'PTNR0002',pattern:'？',uid_list:[],count:0},
      {uid:'PTNR0003',pattern:'！',uid_list:[],count:0}
    ],
    expectedCount:2,
    readMetadataPage:async()=>pages[cursor++],
    readContent:async uids=>articles.filter(article=>uids.includes(article.uid)),
    writePatterns:async ({patterns})=>{
      writeCalls++;
      assert.equal(finished,false);
      const byWord=new Map(patterns.map(row=>[row.pattern,row]));
      assert.deepEqual(byWord.get('月光').uid_list,['GALA0001']);
      assert.deepEqual(byWord.get('？').uid_list,['GALA0001']);
      assert.deepEqual(byWord.get('！').uid_list,['GALA0002']);
      assert.ok(patterns.every(row=>row.count===row.uid_list.length));
    },
    finalize:async stats=>{
      assert.equal(writeCalls,1);
      assert.equal(stats.matchedDocuments,2);
      finished=true;
    }
  });
  assert.equal(writeCalls,1);
  assert.equal(finished,true);
  assert.equal(result.reusedDocuments,0);
  assert.equal(result.parsedDocuments,2);
});

test('checkpoint resumes a full scan without publishing partial Pattern postings',async()=>{
  const patterns=[{uid:'PTNR0001',pattern:'月光',uid_list:[],count:0}];
  const articles=[
    {uid:'GALA0001',title:'月光',content:'第一篇',keyword:true},
    {uid:'GALA0002',title:'月光',content:'第二篇',keyword:true}
  ];
  const readMetadataPage=async({cursor})=>{
    if(cursor===null)return {rows:[{uid:'GALA0001',keyword:true}],nextCursor:1};
    if(cursor===1)return {rows:[{uid:'GALA0002',keyword:true}],nextCursor:2};
    return {rows:[],nextCursor:3};
  };
  const readContent=async uids=>articles.filter(row=>uids.includes(row.uid));
  let checkpoint=null,writes=0,finished=false,t=0;
  const interrupted=await analyzeIncrementalKeywordPatterns({
    scopeId:'loc',classUid:'CLASS001',existingPatterns:patterns,expectedCount:2,
    readMetadataPage,readContent,timeBudgetMs:100,now:()=>t+=40,
    onCheckpoint:async state=>{checkpoint=state;},
    writePatterns:async()=>{writes++;},finalize:async()=>{finished=true;}
  });
  assert.equal(interrupted.incomplete,true);
  assert.ok(checkpoint);
  assert.equal(writes,0);
  assert.equal(finished,false);
  const completed=await analyzeIncrementalKeywordPatterns({
    scopeId:'loc',classUid:'CLASS001',existingPatterns:patterns,expectedCount:2,
    readMetadataPage,readContent,resume:checkpoint,
    writePatterns:async({patterns:rows})=>{
      writes++;
      assert.deepEqual(rows[0].uid_list,['GALA0001','GALA0002']);
      assert.equal(rows[0].count,2);
    },
    finalize:async()=>{finished=true;}
  });
  assert.equal(writes,1);
  assert.equal(finished,true);
  assert.equal(completed.analyzedDocuments,2);
});
