import test from 'node:test';
import assert from 'node:assert/strict';
import {indexKeywordTree,indexSourceTree,sourceLineage,descendantsOfKeyword,keywordClassCatalog,rebuildKeywordUidLists,keywordUidListData,keywordUidListRecord} from '../app/loc/keyword-tree.mjs';
const rows=[
 {uid:'S0p1',type:'category',name:'符文',desc:'符文各種',lists:['C0a1','C0a2'],uid_lists:[]},
 {uid:'C0a1',type:'class',name:'符文66',desc:'66符文',lists:['G001'],uid_lists:[]},
 {uid:'C0a2',type:'class',name:'符文24',desc:'24符文',lists:[],uid_lists:[]},
 {uid:'G001',type:'group',name:'靈魂',desc:'靈魂組',lists:['I001','I002'],uid_lists:[]},
 {uid:'I001',type:'item',name:'靈',desc:'靈之符文',lists:['感','變','覺','精神','麻木','失神','遲鈍','麻醉'],uid_lists:[]},
 {uid:'I002',type:'item',name:'魂',desc:'魂之符文',lists:['意志'],uid_lists:[]}
];
test('Anchor-like UID recursion resolves all four types, no IDs or fixed cardinality',()=>{
 const tree=indexKeywordTree(rows);
 assert.equal(tree.index.size,6);
 assert.deepEqual(descendantsOfKeyword(rows,'C0a1',{type:'item'}).map(item=>item.name),['靈','魂']);
 const {catalog}=keywordClassCatalog(rows,'C0a1');
 assert.deepEqual(catalog.map(item=>item.uid),['I001','I002']);
 assert.deepEqual(catalog[0].keywords,rows[4].lists);
 assert.equal(Object.keys(rows[0]).join(','),'uid,type,name,desc,lists,uid_lists');
});
test('Class UID lists stays empty; Group and Item use same field differently',()=>{
 const updated=rebuildKeywordUidLists(rows,'C0a1',[
  {uid:'Ab12Cd34',classification_group:'G001',hits:[{uid:'I001',times:3}]},
  {uid:'aB12Cd34',classification_group:'G001',hits:[{uid:'I001',times:2},{uid:'I002',times:1}]}
 ]);
 const group=updated.find(row=>row.uid==='G001'),cl=updated.find(row=>row.uid==='C0a1'),item=updated.find(row=>row.uid==='I001');
 assert.deepEqual(group.uid_lists,['Ab12Cd34','aB12Cd34']);
 assert.deepEqual(cl.uid_lists,[]);
 assert.deepEqual(item.uid_lists,[{uid:'Ab12Cd34',times:3},{uid:'aB12Cd34',times:2}]);
 assert.deepEqual(rows[4].uid_lists,[]);
});
test('Rejects broken UID links, duplicate parents and misleading name references',()=>{
 assert.throws(()=>indexKeywordTree([...rows.slice(0,1),{...rows[1],lists:['I001']},...rows.slice(2)]),/hierarchy/);
 assert.throws(()=>indexKeywordTree([...rows,{uid:'S0p2',type:'category',name:'Other',lists:['C0a1']}]),/multiple parents/);
 assert.throws(()=>indexKeywordTree([...rows,{uid:'G002',type:'group',name:'Alt',lists:['靈']}]),/UID/);
});

test('same display name is allowed across Classes and Groups, all membership follows UID',()=>{
 const shared=[
  {uid:'CAT2',type:'category',name:'總稱',lists:['CL11','CL22']},
  {uid:'CL11',type:'class',name:'符文66',lists:['GR11','GR12']},
  {uid:'CL22',type:'class',name:'符文24',lists:['GR22']},
  {uid:'GR11',type:'group',name:'靈魂組',lists:['IT11']},
  {uid:'GR12',type:'group',name:'靈魂組',lists:['IT12']},
  {uid:'GR22',type:'group',name:'靈魂組',lists:['IT22']},
  {uid:'IT11',type:'item',name:'靈之符文',lists:['潛意識']},
  {uid:'IT12',type:'item',name:'靈之符文',lists:['情緒']},
  {uid:'IT22',type:'item',name:'靈之符文',lists:['信念']}
 ];
 const tree=indexKeywordTree(shared);
 assert.equal(tree.index.size,9);
 assert.deepEqual(keywordClassCatalog(shared,'CL11').catalog.map(row=>row.group_uid),['GR11','GR12']);
 assert.deepEqual(keywordClassCatalog(shared,'CL22').catalog.map(row=>row.group_uid),['GR22']);
 const updated=rebuildKeywordUidLists(shared,'CL11',[
  {uid:'Ab12Cd34',classification_group:'GR12',hits:[{uid:'IT12',times:1}]}
 ]);
 assert.deepEqual(updated.find(row=>row.uid==='GR11').uid_lists,[]);
 assert.deepEqual(updated.find(row=>row.uid==='GR12').uid_lists,['Ab12Cd34']);
 assert.throws(()=>rebuildKeywordUidLists(shared,'CL11',[
  {uid:'Ab12Cd34',classification_group:'靈魂組',hits:[]}
 ]),/Group UID/);
});

test('JSONB object contract preserves Group article UID and Item occurrence totals',()=>{
 const group=keywordUidListRecord('group',['Ab12Cd34','aB12Cd34']);
 const item=keywordUidListRecord('item',[{uid:'Ab12Cd34',times:4},{uid:'aB12Cd34',times:2}]);
 assert.deepEqual(group,{articles:['Ab12Cd34','aB12Cd34']});
 assert.deepEqual(item,{hits:[{uid:'Ab12Cd34',times:4},{uid:'aB12Cd34',times:2}]});
 assert.deepEqual(keywordUidListRecord('class',[]),{});
 assert.deepEqual(keywordUidListData('group',group),group.articles);
 assert.deepEqual(keywordUidListData('item',item),item.hits);
 const structured=rows.map(row=>({...row,uid_lists:keywordUidListRecord(row.type,row.uid_lists)}));
 assert.equal(indexKeywordTree(structured).index.size,6);
 assert.throws(()=>keywordUidListData('item',{articles:[]}),/Invalid/);
});

test('Source uses the same Anchor UID tree, not a new source table',()=>{
 const sources=[
  {uid:'Univ0001',type:'universe',title:'Eosteric',attr:{uid:['Gala0001']}},
  {uid:'Gala0001',type:'galaxy',title:'LOC',attr:{uid:['Doma0001']}},
  {uid:'Doma0001',type:'domain',title:'lo3rwang',attr:{uid:['From0001','From0002']}},
  {uid:'From0001',type:'from',title:'facebook',attr:{}},
  {uid:'From0002',type:'from',title:'chatgpt',attr:{}}
 ];
 const tree=indexSourceTree(sources);
 assert.equal(tree.roots[0].name,'Eosteric');
 assert.deepEqual(sourceLineage(sources,'facebook')[0].map(n=>n.type),
   ['universe','galaxy','domain','from']);
 assert.equal(sourceLineage(sources,'github').length,0);
 assert.throws(()=>indexSourceTree(sources.map(n=>n.uid==='Doma0001'
   ?{...n,attr:{uid:['From0001','From0001']}}:n)),/unique/);
 assert.throws(()=>indexSourceTree(sources.map(n=>n.uid==='Doma0001'
   ?{...n,attr:{uid:['Univ0001']}}:n)),/hierarchy/);
});
