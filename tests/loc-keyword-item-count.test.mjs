import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';
import {planKeywordTotalWrites} from '../app/loc/keywords/sql-service.mjs';
import {createItemCountAccumulator,analyzeItemKeywordCounts} from '../app/loc/keywords/item-count-analysis.mjs';
import {compileKeywordLiteralMatcher} from '../app/loc/keywords/literal-matcher.mjs';
import {buildKeywordSearchPatterns,keywordPatternItemMetrics}
  from '../app/loc/keywords/search-pattern.mjs';

const items=[
  {uid:'ITEM0001',item_name:'日',group_uid:'GROUP001',keywords:['日光TO光']},
  {uid:'ITEM0002',item_name:'光',group_uid:'GROUP001',keywords:['光亮']},
  {uid:'ITEM0003',item_name:'封',group_uid:'GROUP001',keywords:['開封NAME','封閉']},
  {uid:'ITEM0004',item_name:'水',group_uid:'GROUP001',keywords:['水土AND地']},
  {uid:'ITEM0005',item_name:'地',group_uid:'GROUP001',keywords:['地表']},
  {uid:'ITEM0006',item_name:'洞',group_uid:'GROUP001',keywords:['黑NOR洞','洞']}
];
const groups=[{uid:'GROUP001',title:'一組'}];
const patterns=[...new Set(items.flatMap(item=>item.keywords))].map((title,index)=>({
  uid:'PATT'+String(index+1).padStart(4,'0'),title
}));
const doc=(uid,content)=>({uid,keyword:true,title:'',content,date:'2026-11-22'});

test('Pattern literals drive matching while Item labels resolve TO AND NAME NOR',()=>{
  const acc=createItemCountAccumulator(items,groups,null,{patterns});
  const rows=[
    doc('GALAXY01','日光'),
    doc('GALAXY02','開封'),
    doc('GALAXY03','水土'),
    doc('GALAXY04','黑洞'),
    doc('GALAXY05','洞穴'),
    doc('GALAXY06','日')
  ];
  acc.state.scanned=rows.length;
  acc.absorb(rows);
  const result=acc.totals();
  assert.ok(result.itemCounts.ITEM0002>0,'TO redirects 日光 to 光');
  assert.equal(result.itemCounts.ITEM0003,0,'NAME masks 開封');
  assert.ok(result.itemCounts.ITEM0004>0,'AND adds original Item');
  assert.ok(result.itemCounts.ITEM0005>0,'AND adds target Item');
  assert.equal(result.itemCounts.ITEM0006,1,'NOR blocks 黑洞 but allows 洞穴');
  assert.equal(result.itemCounts.ITEM0001,0,'Item label 日 is not a literal match');
  assert.equal(result.analyzedDocuments,rows.length);
  assert.equal(result.scannedDocuments,rows.length);
  assert.ok(result.matchedDocuments>=3);
  assert.equal(JSON.stringify(result).includes('GALAXY0'),false);
  assert.ok(acc.daily().some(r=>r.kind==='item_day'));
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

test('tail checkpoint survives finalization failure and retries without reclassifying',async()=>{
  const count=4096+13;
  const docs=Array.from({length:count},(_,i)=>doc(
    String(i+1).padStart(8,'0'),'月光'));
  const terms=[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}];
  let saved=null,attempts=0,reads=0;
  const options={
    items:terms,groups,expectedCount:count,
    pageSize:4096,maxRowsPerRun:8192,minRowsPerRun:4096,
    checkpointRows:4096,deferFinalization:true,now:()=>0,
    readMetadataPage:async({cursor,limit})=>{
      reads++;
      const from=cursor??0;
      return {rows:docs.slice(from,from+limit),
        nextCursor:Math.min(count,from+limit)};
    },
    onCheckpoint:async state=>{saved=structuredClone(state);},
    finalize:async()=>{if(++attempts===1)throw Error('Transient final SQL failure');}
  };
  const tail=await analyzeItemKeywordCounts(options);
  assert.equal(tail.incomplete,true);
  assert.equal(saved.scanned,count);
  assert.equal(saved.finalizePending,true);
  const fetched=reads;
  await assert.rejects(analyzeItemKeywordCounts({...options,resume:saved}),
    /Transient final SQL failure/);
  assert.equal(saved.scanned,count,'failure cannot erase persisted tail');
  const completed=await analyzeItemKeywordCounts({...options,resume:saved});
  assert.equal(completed.scannedDocuments,count);
  assert.equal(attempts,2);
  assert.equal(reads,fetched,'retrying finalization must not SELECT Galaxy again');
});

test('Pattern Lucus UIDs count occurrences during the same article pass, shared once',()=>{
  const linked=[
    {uid:'PATT0001',title:'月光'},
    {uid:'PATT0002',title:'光'},
    {uid:'PATT0003',title:'火'},
    {uid:'PATT0001',title:'月光'} // Two Items may link one UID.
  ];
  const catalog=[
    {uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']},
    {uid:'ITEM0002',item_name:'亮',group_uid:'GROUP001',keywords:['光']}
  ];
  const acc=createItemCountAccumulator(catalog,groups,null,{patterns:linked});
  acc.absorb([
    doc('GALAXY01','月光月光'),
    doc('GALAXY02','光與火'),
    {uid:'GALAXY03',keyword:false,title:'',content:'月光月光'}
  ]);
  assert.deepEqual(acc.totals().patternCounts,{
    PATT0001:2,PATT0002:3,PATT0003:1
  });
  assert.equal(acc.totals().patternCounts.PATT0001,2,
    'Shared Pattern UID must not be added once per Item');
  assert.equal(JSON.stringify(acc.state).includes('GALAXY01'),false,
    'Checkpoint must not carry article UID postings');
  assert.throws(()=>createItemCountAccumulator(catalog,groups,null,{
    patterns:[{uid:'PATT0001',title:'月光'},{uid:'PATT0001',title:'其他'}]
  }),/Conflicting Keyword Pattern/);
});

test('Item labels are not promoted to Patterns in keyword search metrics',()=>{
  const items=[{uid:'ITEM0001',item_name:'標籤名稱',group_uid:'GROUP001',keywords:['明確 Pattern']}];
  const patterns=buildKeywordSearchPatterns('scope1',items,[]);
  assert.deepEqual(patterns.map(row=>row.pattern),['明確 Pattern']);
  const metrics=keywordPatternItemMetrics(items,patterns);
  assert.deepEqual(metrics.items[0].words.map(row=>row.pattern),['明確 Pattern']);
});

test('Sparse Pattern matching preserves overlap counts and Unicode fallback',()=>{
  const matcher=compileKeywordLiteralMatcher(['月光','光','月','火']);
  assert.deepEqual(matcher.countMatches('月光月光火'),[
    ['月光',2],['光',2],['月',2],['火',1]
  ]);
  assert.deepEqual(matcher.countMatches('月光\r\n火'),[
    ['月光',1],['光',1],['月',1],['火',1]
  ]);
  assert.deepEqual(matcher.countMatches('不含詞彙'),[]);
  // 631 unrelated Patterns must not allocate a 631-slot count array
  // for every nonmatching article.
  const big=compileKeywordLiteralMatcher(
    Array.from({length:631},(_,i)=>'稀有詞'+String(i).padStart(3,'0'))
  );
  assert.deepEqual(big.countMatches('普通日記與生活記事'),[]);
  assert.deepEqual(big.countMatches('稀有詞042稀有詞042'),[['稀有詞042',2]]);
});

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

test('keyword aggregate writes normalize repeated physical Item UIDs',()=>{
  const rows=planKeywordTotalWrites([
    {uid:'ITEM0001',total:7},{uid:'GROUP001',total:10},
    {uid:'ITEM0001',total:7}
  ]);
  assert.deepEqual(rows,[
    {uid:'ITEM0001',total:7},{uid:'GROUP001',total:10}
  ]);
  assert.deepEqual(planKeywordTotalWrites([]),[]);
  assert.deepEqual(planKeywordTotalWrites([
    {uid:'PATT0001',total:42},{uid:'PATT0001',total:42}
  ]),[{uid:'PATT0001',total:42}]);
  assert.throws(()=>planKeywordTotalWrites([
    {uid:'ITEM0001',total:7},{uid:'ITEM0001',total:8}
  ]),/Conflicting Keyword counts/);
  assert.throws(()=>planKeywordTotalWrites([
    {uid:'INVALID_UID',total:8}
  ]),/Invalid Keyword aggregate counts/);
  assert.throws(()=>planKeywordTotalWrites([
    {uid:'ITEM0001',total:1.2}
  ]),/Invalid Keyword aggregate counts/);
});

