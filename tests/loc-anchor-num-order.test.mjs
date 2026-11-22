import test from 'node:test';
import assert from 'node:assert/strict';
import {anchorUidListCount} from '../packages/zenstack/anchor-hierarchy.mjs';
import {locAnchorToBlock,locBlockToAnchor} from '../app/loc/blocks/loc-block-anchor.mjs';

test('LOC Block order lives in attr.order, not in num',()=>{
  const original={uid:'ABCD1234',page_name:'index',block_order:5,
    block_title:'Example',block_text:'',block_entity:[3,{uid:'AAAA0001',text:'a'}]};
  const anchor=locBlockToAnchor(original);
  assert.equal(anchor.attr.order,5);
  assert.equal(anchor.num,1);
  assert.equal(locAnchorToBlock({...anchor,num:99}).block_order,5);
});
test('num counts the UID references in each semantic Anchor payload',()=>{
  assert.equal(anchorUidListCount('universe',{uid:['AAAA0001','BBBB0002']}),2);
  assert.equal(anchorUidListCount('period',{uid:['AAAA0001']}),1);
  assert.equal(anchorUidListCount('era',{period:['AAAA0001','BBBB0002']}),2);
  assert.equal(anchorUidListCount('trace',{path:['AAAA0001'],point:['BBBB0002','CCCC0003']}),3);
  assert.equal(anchorUidListCount('pattern',{}),0);
  assert.equal(anchorUidListCount('from',{uid:[],counts:{lo3rwang:123}}),0);
  assert.equal(anchorUidListCount('index',{order:2,uidlist:[3,{uid:'AAAA0001'}]}),1);
  assert.equal(anchorUidListCount('date',{date:'2026-11-23'}),0);
});
