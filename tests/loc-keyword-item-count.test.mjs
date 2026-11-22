import test from 'node:test';
import assert from 'node:assert/strict';
import {createItemCountAccumulator,analyzeItemKeywordCounts,
  itemKeywordSuggestions} from '../app/loc/keywords/item-count-analysis.mjs';

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
