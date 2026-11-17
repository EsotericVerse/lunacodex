import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSourceImportRowsInSlices} from '../app/loc/import/source-validation-slices.mjs';

test('ZModel source validation yields after bounded groups and returns original rows',async()=>{
  const rows=Array.from({length:600},(_,i)=>({raw:{id:i,post_title:'p-'+i}}));
  const checked=[],progress=[];
  let yields=0;
  const result=await assertSourceImportRowsInSlices(rows,'WordPress',(raw,source,index)=>{
    checked.push(index);
    assert.equal(source,'WordPress');
    assert.equal(raw.id,index-1);
  },{onProgress:p=>progress.push(p.completed),yieldControl:async()=>{yields++;}});
  assert.equal(result,rows);
  assert.equal(checked.length,600);
  assert.deepEqual(progress,[256,512,600]);
  assert.equal(yields,2);
});

test('a source model validation error stops before any downstream write',async()=>{
  const rows=Array.from({length:513},(_,i)=>({post_title:'row '+i}));
  let processed=0,yields=0;
  await assert.rejects(assertSourceImportRowsInSlices(rows,'WordPress',(_row,_source,index)=>{
    processed++;
    if(index===300)throw new TypeError('bad source payload');
  },{yieldControl:async()=>{yields++;}}),/bad source payload/);
  assert.equal(processed,300);
  assert.equal(yields,1);
});

test('empty input is a successful no-op without timer or progress churn',async()=>{
  let progress=0,yields=0;
  const rows=[];
  assert.equal(await assertSourceImportRowsInSlices(rows,'Notion',()=>{},{
    onProgress:()=>progress++,yieldControl:async()=>yields++
  }),rows);
  assert.equal(progress,0);
  assert.equal(yields,0);
});
