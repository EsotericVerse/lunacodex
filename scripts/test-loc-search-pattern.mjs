import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKeywordSearchPatterns,splitKeywordPatternBatches} from '../app/loc/keyword-search-pattern.mjs';

const item=(name,keywords=[])=>({item_name:name,keywords});
const hit=(pattern,uid_list)=>({pattern,count:uid_list.length,uid_list});

test('each word has its own UID count, never the Item group total',()=>{
  const rows=buildKeywordSearchPatterns('lo3rwang',[
    item('定錨',['時間定錨','空間定錨'])
  ],[
    hit('定錨',['Ab12Cd34','Ef56Gh78']),
    hit('時間定錨',['Ab12Cd34']),
    hit('空間定錨',['Ef56Gh78'])
  ]);
  const byWord=new Map(rows.map(row=>[row.pattern,row]));
  assert.equal(byWord.get('定錨').count,2);
  assert.equal(byWord.get('時間定錨').count,1);
  assert.equal(byWord.get('空間定錨').count,1);
  assert.deepEqual(byWord.get('時間定錨').uid_list,['Ab12Cd34']);
  assert.ok(rows.every(row=>row.scopeid==='lo3rwang'));
});

test('a literal title with no own matches must have zero count',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('符韻',['心情','喜悅'])
  ],[hit('心情',['Ab12Cd34'])]);
  const byWord=new Map(rows.map(row=>[row.pattern,row]));
  assert.equal(byWord.get('符韻').count,0);
  assert.equal(byWord.get('喜悅').count,0);
  assert.equal(byWord.get('心情').count,1);
});

test('the same word shared by multiple Items is indexed once per article',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('文化',['歷史']),
    item('歷史',['文化'])
  ],[hit('歷史',['Ab12Cd34','Ef56Gh78']),
     hit('文化',['Ab12Cd34'])]);
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.pattern==='歷史').count,2);
  assert.equal(rows.find(row=>row.pattern==='文化').count,1);
});

test('NFKC-normalized matching retains one canonical visible word',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('文化',['文化','文Ａ'])
  ],[hit('文A',['Ab12Cd34']),hit('文化',['Ef56Gh78'])]);
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.pattern==='文A').count,1);
});

test('judgement instructions are not stored as literal keyword suggestions',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('星',['星','混沌AND定錨','日NOR月','星TO光'])
  ],[hit('星',['Ab12Cd34'])]);
  assert.deepEqual(rows.map(row=>row.pattern),['星']);
});

test('reject invalid identities or inconsistent per-word counts',()=>{
  assert.throws(()=>buildKeywordSearchPatterns('bad.scope',[item('文化')]),/Scope/);
  assert.throws(()=>buildKeywordSearchPatterns('scope',[item('文化')],[
    {pattern:'文化',count:2,uid_list:['Ab12Cd34']}
  ]),/count/);
  assert.throws(()=>buildKeywordSearchPatterns('scope',[item('文化')],[
    hit('文化',['BadUID'])
  ]),/UID/);
  assert.throws(()=>buildKeywordSearchPatterns('scope',[item('文化')],[
    hit('不存在',['Ab12Cd34'])
  ]),/unknown Keyword word/);
});

test('empty analysis still exposes zero-count literal words',()=>{
  const rows=buildKeywordSearchPatterns('scope',[item('定錨',['靈魂定錨'])],[]);
  assert.deepEqual(rows.map(row=>row.count),[0,0]);
  assert.ok(rows.every(row=>row.uid_list.length===0));
});

test('large per-word UID lists split below the SQL 1 MiB POST cap',()=>{
  const ids=Array.from({length:120},(_,i)=>'Ab'+String(i).padStart(6,'0'));
  const rows=Array.from({length:8},(_,i)=>({
    scopeid:'scope',pattern:'詞'+i,count:ids.length,uid_list:ids
  }));
  const batches=splitKeywordPatternBatches(rows,2100);
  assert.ok(batches.length>1);
  assert.deepEqual(batches.flat(),rows);
  for(const batch of batches){
    const bytes=new TextEncoder().encode(JSON.stringify({
      kind:'managed-action',name:'sync_search_patterns',
      args:{p_scope_id:'scope',p_class_uid:'Ab123456',p_patterns:batch,p_final:true}
    })).byteLength;
    assert.ok(bytes<2100,'batch exceeds upload limit');
  }
});

test('a single word over the transport payload limit fails explicitly',()=>{
  const ids=Array.from({length:80},(_,i)=>'Ab'+String(i).padStart(6,'0'));
  const row={scopeid:'scope',pattern:'測試',count:ids.length,uid_list:ids};
  assert.throws(()=>splitKeywordPatternBatches([row],500),/同步上限/);
});
