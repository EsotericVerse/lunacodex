// Run with: node --test scripts/test-incremental-checkpoint.mjs
//
// Regression test for a real bug: the time-budget check used to be gated
// behind "every checkEveryPages (50) pages". At the target ~800ms/page, 50
// pages alone add up to multiples of the whole Cloudflare time budget, so
// that gate could let the request get hard-killed before the check ever
// ran once - defeating checkpointing entirely. The fix checks every page
// (cheap: Date.now()) and only pays the real cost (writing a checkpoint)
// once, when the condition actually trips.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeIncrementalKeywordPatterns} from '../app/loc/keywords/incremental.mjs';

const SCOPE_ID='loc',CLASS_UID='AbCdEf01';

// All rows report keyword:false, so nothing ever reaches the classifier -
// these tests exercise paging/checkpoint/resume mechanics in isolation.
function rowsForPage(pageIndex,size){
  return Array.from({length:size},(_,i)=>({
    uid:String(pageIndex*1000+i).padStart(8,'0').replace(/\d/g,d=>
      'ABCDEFGHIJ'[d]), // keep it UID-regex-safe (letters only)
    UpdateTime:null,keyword:false
  }));
}

function harness({pageRows,msPerPage,timeBudgetMs}){
  let now=0,calls=0;
  const nowFn=()=>now;
  const readMetadataPage=async({cursor,limit})=>{
    const index=cursor?.index??0;
    now+=msPerPage;
    calls++;
    if(index>=pageRows.length)return {rows:[],nextCursor:{index}};
    return {rows:rowsForPage(index,pageRows[index]),nextCursor:{index:index+1}};
  };
  const checkpoints=[];
  return {
    nowFn,readMetadataPage,checkpoints,
    callCount:()=>calls,
    run:resume=>analyzeIncrementalKeywordPatterns({
      scopeId:SCOPE_ID,classUid:CLASS_UID,treeRows:[],items:[],
      existingPatterns:[],patternScans:{},
      pageSize:pageRows[0]||100,readMetadataPage,now:nowFn,
      resume,timeBudgetMs,onCheckpoint:async progress=>{checkpoints.push(progress);},
      readContent:async()=>[],writePatterns:async()=>{},
      finalize:async()=>{}
    })
  };
}

test('checkpoints on the very next page once the time budget is crossed, not after 50 pages',async()=>{
  // 10 pages available; each one "takes" 500ms. Budget is 1000ms, so the
  // 80% trip point (800ms) falls inside page 2 - the old "every 50 pages"
  // gate would never have checked in time for a request this short.
  const h=harness({pageRows:Array(10).fill(100),msPerPage:500,timeBudgetMs:1000});
  const result=await h.run(null);
  assert.equal(result.incomplete,true);
  assert.equal(h.callCount(),2,'should stop after the 2nd page, not run all 10');
  assert.equal(h.checkpoints.length,1);
  assert.equal(result.scanned,200);
});

test('a resumed call continues from the checkpoint and finishes the remaining pages',async()=>{
  const h1=harness({pageRows:Array(4).fill(50),msPerPage:500,timeBudgetMs:1000});
  const first=await h1.run(null);
  assert.equal(first.incomplete,true);
  const checkpoint=h1.checkpoints[0];
  assert.equal(checkpoint.scanned,100);

  // Fresh invocation (new request, clock reset to 0), same checkpoint,
  // large enough budget to finish the rest in one go.
  const h2=harness({pageRows:Array(4).fill(50),msPerPage:500,timeBudgetMs:1_000_000});
  let finalized=null;
  const final=await analyzeIncrementalKeywordPatterns({
    scopeId:SCOPE_ID,classUid:CLASS_UID,treeRows:[],items:[],
    existingPatterns:[],patternScans:{},
    pageSize:50,readMetadataPage:h2.readMetadataPage,now:h2.nowFn,
    resume:checkpoint,timeBudgetMs:1_000_000,
    onCheckpoint:async()=>{throw new Error('should not checkpoint again')},
    readContent:async()=>[],writePatterns:async()=>{},
    finalize:async stats=>{finalized=stats;}
  });
  assert.equal(final.incomplete,undefined);
  assert.equal(final.analyzedDocuments,200,'resumed scan must cover every row exactly once');
  assert.ok(finalized);
});

test('no onCheckpoint/timeBudgetMs means the old one-shot behavior (never checkpoints)',async()=>{
  const h=harness({pageRows:Array(3).fill(10),msPerPage:5000,timeBudgetMs:null});
  const result=await analyzeIncrementalKeywordPatterns({
    scopeId:SCOPE_ID,classUid:CLASS_UID,treeRows:[],items:[],
    existingPatterns:[],patternScans:{},
    pageSize:10,readMetadataPage:h.readMetadataPage,now:h.nowFn,
    readContent:async()=>[],writePatterns:async()=>{},finalize:async()=>{}
  });
  assert.equal(result.incomplete,undefined);
  assert.equal(result.analyzedDocuments,30);
});
