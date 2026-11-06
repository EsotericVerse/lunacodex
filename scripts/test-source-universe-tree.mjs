import {sourceNodePermission,assertSourceNodeWritePermission} from '../app/loc/source-node-permission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_KEYWORD_LEVELS,sourceTreeFromArrays,sourceTreeFromAnchors,sourceTaxonomyFromArrays,
  sourceSiteKeyForLabel,sourceLabelMatchesSite
} from '../app/loc/source-classification.mjs';
import {publishedSourceTaxonomy,publishedSourceCategoryCatalog}
  from '../app/modular/published-source-taxonomy.js';

test('the four source types align exactly to the existing keyword levels',()=>{
  assert.deepEqual(SOURCE_KEYWORD_LEVELS,{
    universe:'category',galaxy:'class',domain:'group',from:'item'
  });
  const tree=sourceTreeFromArrays(['Facebook','Threads'],['方格子vocus','其他'],
    {universe:'loc',galaxy:'lo3rwang'});
  assert.equal(tree[0].type,'universe');
  assert.equal(tree[1].type,'galaxy');
  assert.equal(tree[1].parent,tree[0].key);
  assert.equal(tree.filter(row=>row.type==='domain').length,2);
  assert.equal(tree.filter(row=>row.type==='from').length,4);
  for(const node of tree.slice(2)){
    assert.equal(node.keyword_type,SOURCE_KEYWORD_LEVELS[node.type]);
    assert.ok(tree.some(parent=>parent.key===node.parent&&parent.children.includes(node.key)));
  }
  assert.equal(tree.find(row=>row.name==='Facebook').site,'Facebook');
});
test('site is never replaced with display label and aliases come from one rule',()=>{
  assert.equal(sourceSiteKeyForLabel('方格子vocus'),'vocus');
  assert.equal(sourceSiteKeyForLabel('無名wretch'),'wretch');
  assert.equal(sourceSiteKeyForLabel('其他'),'others');
  assert.equal(sourceSiteKeyForLabel('Facebook'),'facebook');
  assert.equal(sourceLabelMatchesSite('vocus','方格子vocus'),true);
  assert.equal(sourceLabelMatchesSite('others','其他'),true);
  assert.equal(sourceLabelMatchesSite('art','smart'),false);
  assert.equal(sourceLabelMatchesSite('facebook','Facebook'),true);
  const published=publishedSourceTaxonomy('lo3rwang');
  assert.ok(published.tree.find(row=>row.type==='universe'));
  assert.ok(published.tree.find(row=>row.type==='galaxy'&&row.name==='lo3rwang'));
  assert.ok(published.groupAliases.some(row=>row.source_key==='vocus'));
  assert.ok(published.groupAliases.some(row=>row.source_key==='wretch'));
  assert.ok(published.groupAliases.some(row=>row.source_key==='others'));
  assert.ok(publishedSourceCategoryCatalog('lo3rwang').aliases.some(row=>row.source_key==='vocus'));
});
test('legacy consumers get unchanged empty and flat taxonomy shapes',()=>{
  assert.deepEqual(sourceTaxonomyFromArrays([],[]),
    {categories:[],aliases:[],groups:[],groupAliases:[]});
  assert.deepEqual(sourceTaxonomyFromArrays(['Facebook'],['suno','FACEBOOK']).groups,
    [{group_code:'suno',display_name:'suno',enabled:true}]);
});

test('physical Anchor source hierarchy projects into keyword-shaped UI nodes',()=>{
 const rows=[
  {uid:'Aa000001',type:'universe',title:'Eosteric',attr:{uid:['Aa000002']}},
  {uid:'Aa000002',type:'galaxy',title:'LOC',attr:{uid:['Aa000003']}},
  {uid:'Aa000003',type:'domain',title:'lo3rwang',attr:{uid:['Aa000004']}},
  {uid:'Aa000004',type:'from',title:'facebook',attr:{}}
 ];
 const nodes=sourceTreeFromAnchors(rows);
 assert.deepEqual(nodes.map(n=>n.keyword_type),['category','class','group','item']);
 assert.equal(nodes[3].site,'facebook');
 assert.equal(nodes[3].parent,nodes[2].uid);
 assert.equal(nodes[0].children[0],nodes[1].uid);
});

test('Scope sees LOC ancestors and its own source branch, never sibling Scopes',()=>{
 const allow=(viewerScopeId,nodeType,nodeScopeId,canManageLoc=false,canManageScope=false)=>
   sourceNodePermission({viewerScopeId,nodeType,nodeScopeId,canManageLoc,canManageScope});
 assert.deepEqual(allow('loc','domain','lo3rwang',true),{read:true,edit:false});
 assert.deepEqual(allow('loc','galaxy','loc',true),{read:true,edit:true});
 assert.deepEqual(allow('lo3rwang','universe','loc',false,true),{read:true,edit:false});
 assert.deepEqual(allow('lo3rwang','galaxy','loc',false,true),{read:true,edit:false});
 assert.deepEqual(allow('lo3rwang','domain','lo3rwang',false,true),{read:true,edit:true});
 assert.deepEqual(allow('lo3rwang','from','lo3rwang',false,true),{read:true,edit:true});
 assert.deepEqual(allow('lo3rwang','domain','lrunes',false,true),{read:false,edit:false});
 assert.deepEqual(allow('lo3rwang','from','lrunes',false,true),{read:false,edit:false});
 assert.throws(()=>assertSourceNodeWritePermission({
   viewerScopeId:'loc',nodeType:'from',nodeScopeId:'lo3rwang',canManageLoc:true
 }),/denied/);
});
