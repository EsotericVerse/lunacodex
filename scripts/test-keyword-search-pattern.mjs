import test from 'node:test';
import assert from 'node:assert/strict';
import {reanalyzeKeywordClass} from '../app/loc/keyword-reanalysis.mjs';
import {buildKeywordSearchPatterns} from '../app/loc/keyword-search-pattern.mjs';

const tree=[
  {uid:'CAT1',type:'category',name:'知識',lists:['CL01']},
  {uid:'CL01',type:'class',name:'歷史',lists:['GR01']},
  {uid:'GR01',type:'group',name:'時間',lists:['IT01','IT02']},
  {uid:'IT01',type:'item',name:'定錨',lists:['投錨']},
  {uid:'IT02',type:'item',name:'時間',lists:['投錨','時間錨點']}
];

test('Item title and each literal child word get independent counts and article UIDs',async()=>{
  const docs=[
    {uid:'Ab123456',content:'定錨、投錨與投錨'},
    {uid:'Cd123456',content:'投錨'},
    {uid:'Ef123456',content:'其他文章'}
  ];
  let patterns=null;
  const writes=[];
  await reanalyzeKeywordClass({
    classUid:'CL01',treeRows:tree,pageSize:1,
    readPage:async({offset,limit})=>docs.slice(offset,offset+limit),
    writeNode:async row=>writes.push(row),
    writePatterns:async ({items,termMatches})=>{
      patterns=buildKeywordSearchPatterns('lo3rwang',items,termMatches);
    },
    finalize:async()=>{}
  });
  const lookup=new Map(patterns.map(row=>[row.pattern,row]));
  assert.deepEqual(lookup.get('定錨'),{
    scopeid:'lo3rwang',pattern:'定錨',count:1,uid_list:['Ab123456']
  });
  assert.deepEqual(lookup.get('投錨'),{
    scopeid:'lo3rwang',pattern:'投錨',count:2,
    uid_list:['Ab123456','Cd123456']
  });
  assert.deepEqual(lookup.get('時間'),{
    scopeid:'lo3rwang',pattern:'時間',count:0,uid_list:[]
  });
  assert.equal(lookup.get('時間錨點').count,0);
  // Original Item scoring is independent; repeated word across Items does
  // not double-count one word's own article UID list.
  assert.equal(writes.find(row=>row.uid==='IT01').uid_lists.length,2);
  assert.equal(writes.find(row=>row.uid==='IT02').uid_lists.length,2);
});

test('Keyword rule expressions do not become literal search patterns',()=>{
  const rows=buildKeywordSearchPatterns('lo3rwang',[
    {item_name:'定錨',keywords:['時間錨點','定錨NOR禁止']}
  ],[{pattern:'時間錨點',count:1,uid_list:['Ab123456']}]);
  assert.deepEqual(rows.map(row=>row.pattern),['定錨','時間錨點']);
  assert.equal(rows[0].count,0);
});

test('A word count must agree with the number of unique matched article UIDs',()=>{
  assert.throws(()=>buildKeywordSearchPatterns('lo3rwang',[
    {item_name:'定錨',keywords:[]}
  ],[{pattern:'定錨',count:2,uid_list:['Ab123456']}]),/count/);
});
