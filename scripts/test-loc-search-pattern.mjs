import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKeywordSearchPatterns} from '../app/loc/keyword-search-pattern.mjs';

const item=(name,keywords,total,uidlists)=>({
  item_name:name,keywords,uid_lists:{total,uidlists}
});

test('Item title and literal aliases reuse analyzed totals and deduplicated UIDs',()=>{
  const rows=buildKeywordSearchPatterns('lo3rwang',[
    item('定錨',['時間定錨','空間定錨'],4,['Ab12Cd34','Ef56Gh78']),
  ]);
  assert.deepEqual(rows.map(x=>x.pattern),['定錨','時間定錨','空間定錨'].sort((a,b)=>a.localeCompare(b)));
  assert.ok(rows.every(x=>x.scopeid==='lo3rwang'&&x.count===4&&
    x.uid_list.length===2&&x.uid_list[0]==='Ab12Cd34'));
});

test('same term across Items sums Item counts and unions article UIDs',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('文化',['歷史'],2,['Ab12Cd34']),
    item('歷史',['文化'],5,['Ab12Cd34','Ef56Gh78'])
  ]);
  assert.equal(rows.length,2);
  assert.ok(rows.every(x=>x.count===7));
  assert.ok(rows.every(x=>x.uid_list.join(',')==='Ab12Cd34,Ef56Gh78'));
});

test('Item title is not double-counted when repeated in its words',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('文化',['文化','文化','文\uFF21'],3,['Ab12Cd34'])
  ]);
  assert.equal(rows.find(x=>x.pattern==='文化').count,3);
  assert.equal(rows.length,2);
  assert.equal(rows.find(x=>x.pattern==='文A').count,3);
});

test('judgement rule syntax is not presented as a literal searchable term',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    item('星',['星','混沌AND定錨','日NOR月','星TO光'],2,['Ab12Cd34'])
  ]);
  assert.deepEqual(rows.map(x=>x.pattern),['星']);
});

test('legacy Item hit arrays remain supported without another analysis',()=>{
  const rows=buildKeywordSearchPatterns('scope',[
    {item_name:'痕跡',keywords:[],uid_lists:[{uid:'Ab12Cd34',times:2},{uid:'Ef56Gh78',times:1}]}
  ]);
  assert.deepEqual(rows[0],{
    scopeid:'scope',pattern:'痕跡',count:3,uid_list:['Ab12Cd34','Ef56Gh78']
  });
});

test('reject invalid or duplicated article identities in pattern inputs',()=>{
  assert.throws(()=>buildKeywordSearchPatterns('bad.scope',[item('文化',[],2,['Ab12Cd34'])]),/Scope/);
  assert.throws(()=>buildKeywordSearchPatterns('scope',[item('文化',[],2,['BadUID'])]),/UID/);
  assert.throws(()=>buildKeywordSearchPatterns('scope',[item('文化',[],-2,['Ab12Cd34'])]),/count/);
});

test('zero-hit Item names remain in autocomplete until first reanalysis',()=>{
  const rows=buildKeywordSearchPatterns('scope',[item('定錨',['靈魂定錨'],0,[])]);
  assert.deepEqual(rows.map(x=>x.count),[0,0]);
  assert.ok(rows.every(x=>x.uid_list.length===0));
});
