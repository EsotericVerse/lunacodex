import test from 'node:test';
import assert from 'node:assert/strict';
import {createItemCountAccumulator,analyzeItemKeywordCounts,
  itemKeywordSuggestions,createKeywordScanRate,
  KEYWORD_SCAN_START_RATE,KEYWORD_SCAN_MAX_RATE,
  KEYWORD_SCAN_CHECKPOINT_ROWS}
  from '../app/loc/keywords/item-count-analysis.mjs';

const items=[
  {uid:'ITEM0001',item_name:'日',group_uid:'GROUP001',keywords:['日光TO光']},
  {uid:'ITEM0002',item_name:'光',group_uid:'GROUP001',keywords:['光亮']},
  {uid:'ITEM0003',item_name:'封',group_uid:'GROUP001',keywords:['開封NAME','封閉']},
  {uid:'ITEM0004',item_name:'水',group_uid:'GROUP001',keywords:['水土AND地']},
  {uid:'ITEM0005',item_name:'地',group_uid:'GROUP001',keywords:['地表']},
  {uid:'ITEM0006',item_name:'洞',group_uid:'GROUP001',keywords:['黑NOR洞']}
];
const groups=[{uid:'GROUP001',title:'一組'}];
const doc=(uid,content)=>({uid,keyword:true,title:'',content,date:'2026-11-22'});

test('Item engine honors TO AND NAME NOR and stores counts rather than article IDs',()=>{
  const acc=createItemCountAccumulator(items,groups);
  const rows=[
    doc('GALAXY01','日光'),
    doc('GALAXY02','開封'),
    doc('GALAXY03','水土'),
    doc('GALAXY04','黑洞'),
    doc('GALAXY05','洞穴')
  ];
  acc.state.scanned=rows.length;
  acc.absorb(rows);
  const result=acc.totals();
  assert.ok(result.itemCounts.ITEM0002>0,'TO redirects 日光 to 光');
  assert.equal(result.itemCounts.ITEM0003,0,'NAME masks 開封');
  assert.ok(result.itemCounts.ITEM0004>0,'AND adds original Item');
  assert.ok(result.itemCounts.ITEM0005>0,'AND adds target Item');
  assert.equal(result.itemCounts.ITEM0006,1,'NOR blocks 黑洞 but allows 洞穴');
  assert.equal(result.analyzedDocuments,rows.length);
  assert.equal(result.scannedDocuments,rows.length);
  assert.ok(result.matchedDocuments>=3);
  assert.equal(JSON.stringify(result).includes('GALAXY0'),false);
  assert.ok(acc.daily().some(r=>r.kind==='item_day'));
});

test('Resumable Item scan checkpoints counters only and never writes Pattern postings',async()=>{
  const subset=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  const documents=[doc('GALAXY01','月光'),doc('GALAXY02','月光')];
  const page=async ({cursor})=>cursor===null
    ?{rows:[{uid:'GALAXY01',keyword:true}],nextCursor:'one'}
    :cursor==='one'
      ?{rows:[{uid:'GALAXY02',keyword:true}],nextCursor:'two'}
      :{rows:[],nextCursor:'two'};
  const readContent=async ids=>documents.filter(x=>ids.includes(x.uid));
  let saved=null,writes=0,clock=0;
  const first=await analyzeItemKeywordCounts({
    items:subset,groups,expectedCount:2,readMetadataPage:page,readContent,
    pageSize:1,timeBudgetMs:100,now:()=>clock+=40,
    onCheckpoint:async receipt=>{saved=receipt;},
    finalize:async()=>{writes++;}
  });
  assert.equal(first.incomplete,true);
  assert.equal(writes,0);
  assert.equal(saved.scanMode,'item_count_v1');
  assert.equal(JSON.stringify(saved).includes('GALAXY01'),false);
  const second=await analyzeItemKeywordCounts({
    items:subset,groups,expectedCount:2,readMetadataPage:page,readContent,
    resume:saved,pageSize:1,
    finalize:async totals=>{
      writes++;
      assert.equal(totals.itemCounts.ITEM0001,2);
      assert.equal(totals.itemDocuments.ITEM0001,2);
      assert.equal(totals.matchedDocuments,2);
    }
  });
  assert.equal(second.scannedDocuments,2);
  assert.equal(writes,1);
});

test('Item autocomplete excludes rule tokens; no Pattern index required',()=>{
  const suggestions=itemKeywordSuggestions(items,'日');
  assert.deepEqual(suggestions.map(s=>s.pattern),['日']);
  assert.equal(itemKeywordSuggestions(items,'日光').length,0);
});

test('native SQL keyword page avoids a second UID content query',async()=>{
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  let pages=0,finalized=null;
  const result=await analyzeItemKeywordCounts({
    items:terms,groups,expectedCount:2,pageSize:2,
    readMetadataPage:async ({cursor})=>{
      pages++;
      return cursor===null?{rows:[
        {uid:'GALAXY01',keyword:true,title:'',content:'月光',date:'2026-11-22'},
        {uid:'GALAXY02',keyword:false,title:null,content:null,date:'2026-11-22'}
      ],nextCursor:'done'}:{rows:[],nextCursor:'done'};
    },
    readContent:async()=>{throw Error('Second content SELECT must not run');},
    finalize:async totals=>{finalized=totals;}
  });
  assert.equal(pages,2);
  assert.equal(result.scannedDocuments,2);
  assert.equal(result.parsedDocuments,1);
  assert.equal(finalized.itemCounts.ITEM0001,1);
});

test('Keyword analysis stores once per 8192-row batch and continues beyond 8192 total articles',async()=>{
  const total=8195;
  const docs=Array.from({length:total},(_,i)=>({
    uid:String(i+1).padStart(8,'0'),
    title:'',content:'月光',date:'2026-11-22',keyword:true
  }));
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  const reader=async({cursor,limit})=>{
    const from=cursor??0,rows=docs.slice(from,from+limit);
    return {rows,nextCursor:from+rows.length};
  };
  let durable=null,completed=0,requests=0;
  const checkpoints=[];
  const persist=async state=>{
    durable=JSON.parse(JSON.stringify(state));
    checkpoints.push(state.scanned);
  };
  let final=null;
  do{
    const result=await analyzeItemKeywordCounts({
      items:terms,groups,expectedCount:total,
      readMetadataPage:reader,resume:durable,pageSize:256,
      maxRowsPerRun:8192,minRowsPerRun:4096,checkpointRows:8192,
      timeBudgetMs:15000,now:()=>0,onCheckpoint:persist,
      finalize:async counts=>{completed++;final=counts;}
    });
    requests++;
    assert.ok(requests<=3,'Whole Scope cannot be limited to 8192 rows');
    if(!result.incomplete)break;
    assert.equal(result.scanned,durable.scanned,'Batch must commit cursor before returning');
    assert.equal(result.scanned,8192);
  }while(true);
  assert.equal(requests,2);
  assert.equal(completed,1);
  assert.equal(final.scannedDocuments,total);
  assert.equal(final.analyzedDocuments,total);
  assert.equal(final.itemDocuments.ITEM0001,total);
  assert.deepEqual(checkpoints,[8192],'Normal batches must write one SQL checkpoint only');
});

test('Keyword analysis recovers after an interrupted request from last durable checkpoint',async()=>{
  const docs=Array.from({length:800},(_,i)=>({
    uid:String(i+1).padStart(8,'0'),
    title:'',content:'月光',date:'2026-11-22',keyword:true
  }));
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  let durable=null,crash=true,final=null;
  const reader=async({cursor,limit})=>{
    const from=cursor??0;
    if(crash&&durable&&from>=durable.scanned)throw Error('Transport interrupted');
    const rows=docs.slice(from,from+limit);
    return {rows,nextCursor:from+rows.length};
  };
  const opts={
    items:terms,groups,expectedCount:docs.length,readMetadataPage:reader,
    pageSize:256,checkpointRows:512,
    onCheckpoint:async state=>{durable=JSON.parse(JSON.stringify(state));},
    finalize:async counts=>{final=counts;}
  };
  await assert.rejects(analyzeItemKeywordCounts(opts),/Transport interrupted/);
  assert.ok(durable.scanned>=512&&durable.scanned<800);
  assert.equal(durable.cursor,durable.scanned);
  assert.equal(final,null);
  crash=false;
  const result=await analyzeItemKeywordCounts({...opts,resume:durable});
  assert.equal(result.scannedDocuments,800);
  assert.equal(result.analyzedDocuments,800);
  assert.equal(result.itemDocuments.ITEM0001,800);
  assert.equal(final.itemCounts.ITEM0001,800);
});

test('adaptive Keyword batch commits at 4096 when measured throughput is too slow for 8192',async()=>{
  const rows=Array.from({length:16},(_,i)=>doc(String(i+1).padStart(8,'0'),'月光'));
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  let clock=0,saved=null,finalized=0,reads=0;
  const result=await analyzeItemKeywordCounts({
    items:terms,groups,expectedCount:rows.length,pageSize:3,
    minRowsPerRun:4,maxRowsPerRun:8,checkpointRows:8,
    timeBudgetMs:100,now:()=>clock,
    readMetadataPage:async({cursor,limit})=>{
      const from=cursor??0,part=rows.slice(from,from+limit);
      reads++;
      clock=from+part.length>=4?40:20;
      return {rows:part,nextCursor:from+part.length};
    },
    onCheckpoint:async progress=>{saved=JSON.parse(JSON.stringify(progress));},
    finalize:async()=>{finalized++;}
  });
  assert.equal(result.incomplete,true);
  assert.equal(result.scanned,4);
  assert.equal(saved.scanned,4);
  assert.equal(saved.cursor,4);
  assert.equal(finalized,0);
  assert.ok(reads>=2);
});

test('adaptive Keyword batch reaches 8192 without a redundant 4096 checkpoint',async()=>{
  const docs=Array.from({length:8200},(_,i)=>
    doc(String(i+1).padStart(8,'0'),'月光'));
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  const checkpoints=[];
  const result=await analyzeItemKeywordCounts({
    items:terms,groups,expectedCount:docs.length,pageSize:256,
    minRowsPerRun:4096,maxRowsPerRun:8192,checkpointRows:8192,
    timeBudgetMs:15000,now:()=>0,
    readMetadataPage:async({cursor,limit})=>{
      const from=cursor??0,rows=docs.slice(from,from+limit);
      return {rows,nextCursor:from+rows.length};
    },
    onCheckpoint:async progress=>checkpoints.push(progress.scanned),
    finalize:async()=>{throw Error('Batch must continue after 8192');}
  });
  assert.equal(result.incomplete,true);
  assert.equal(result.scanned,8192);
  assert.deepEqual(checkpoints,[8192]);
});

test('Keyword per-second target ramps gently from 1024 to 8192 and never resets at 4096 checkpoints',async()=>{
  assert.equal(KEYWORD_SCAN_START_RATE,1024);
  assert.equal(KEYWORD_SCAN_MAX_RATE,8192);
  assert.equal(KEYWORD_SCAN_CHECKPOINT_ROWS,4096);
  let time=0,done=0;
  const rate=createKeywordScanRate({
    now:()=>time,sleep:async ms=>{time+=ms;}
  });
  const steps=[];
  while(done<4096){
    const part=await rate.take(4096-done);
    steps.push({part,target:rate.target,time});
    rate.complete(part);
    done+=part;
  }
  assert.deepEqual(steps.map(x=>x.part),[1024,2048,1024]);
  assert.equal(rate.target,3072);
  // Checkpoint records the cumulative number but CANNOT affect this
  // controller's remaining per-second budget or carried rate.
  assert.equal(done,4096);
  const afterCheckpoint=await rate.take(4096);
  assert.equal(afterCheckpoint,2048);
  assert.equal(rate.target,3072);
  rate.complete(afterCheckpoint);
  const targets=[...steps.map(x=>x.target),rate.target];
  while(rate.target<8192){
    const part=await rate.take(8192);
    rate.complete(part);
    targets.push(rate.target);
    assert.ok(targets.length<20);
  }
  assert.equal(rate.target,8192);
  assert.ok(targets.every(x=>x>=1024&&x<=8192));
  assert.ok(targets.every((x,i)=>i===0||x>=targets[i-1]&&x-targets[i-1]<=1024));
});

test('Keyword checkpoint preserves the ramp across HTTP requests without resetting to 296/s',async()=>{
  const docs=Array.from({length:8193},(_,i)=>
    doc(String(i+1).padStart(8,'0'),'月光'));
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  let ms=0,saved=null;
  const stored=[],queries=[];
  const opts={
    items:terms,groups,expectedCount:docs.length,
    pageSize:4096,maxRowsPerRun:4096,checkpointRows:4096,paceRows:true,
    now:()=>ms,rateSleep:async delay=>{ms+=delay;},
    readMetadataPage:async({cursor,limit})=>{
      queries.push(limit);
      const index=cursor??0,rows=docs.slice(index,index+limit);
      return {rows,nextCursor:index+rows.length};
    },
    onCheckpoint:async state=>{
      saved=JSON.parse(JSON.stringify(state));
      stored.push({scanned:saved.scanned,target:saved.targetRowsPerSecond});
    },
    finalize:async()=>{throw Error('Must not complete in a 4096-row request');}
  };
  const first=await analyzeItemKeywordCounts(opts);
  assert.equal(first.incomplete,true);
  assert.equal(first.scanned,4096);
  assert.equal(saved.scanned,4096);
  assert.equal(saved.targetRowsPerSecond,3072);
  const second=await analyzeItemKeywordCounts({...opts,resume:saved});
  assert.equal(second.incomplete,true);
  assert.equal(second.scanned,8192);
  assert.deepEqual(queries,[4096,4096]);
  assert.deepEqual(stored.map(x=>x.scanned),[4096,8192]);
  assert.ok(stored[1].target>=stored[0].target);
  assert.equal(stored[1].target,4096);
});
