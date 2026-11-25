import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPUTE_PROTOCOL} from '../app/loc/compute/contract.mjs';
import {runComputeJob} from '../app/loc/compute/operations.mjs';
import {createItemCountAccumulator} from '../app/loc/keywords/item-count-analysis.mjs';
import {matchExistingImportBySiteId,matchExistingImportByCreatedAt} from '../app/loc/import/duplicate-check.mjs';

const execute=(kind,payload)=>runComputeJob({protocol:COMPUTE_PROTOCOL,kind,payload});
test('keyword compute returns identical ordered accumulator state',async()=>{
  const items=[{uid:'item0001',item_name:'文字',group_uid:'group001',keywords:['文字']}];
  const groups=[{uid:'group001',title:'語言'}];
  const patterns=[{uid:'word0001',title:'文字'}];
  const minChars=0,rows=[{uid:'article1',title:'文字',content:'文字文字',keyword:true},
    {uid:'article2',title:'文字',content:'文字',keyword:false}];
  const local=createItemCountAccumulator(items,groups,null,{minChars,patterns});
  const state=JSON.parse(JSON.stringify(local.state));
  local.absorb(rows);
  assert.deepEqual(await execute('keyword',{items,groups,patterns,minChars,state,rows}),local.state);
});
function rows(n,withIds=true){
  return Array.from({length:n},(_,i)=>({uid:'a'+String(i).padStart(7,'0'),
    site:'Facebook',site_id:withIds?'source'+i:'',
    createtime:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}));
}
test('large identity comparison preserves stored rows and falls back to original matcher',async()=>{
  const incoming=rows(600),saved=incoming.map((row,i)=>({...row,uid:'b'+String(i).padStart(7,'0'),content:'not sent'}));
  const readSiteIds=async(ids,consume)=>consume(saved);
  let calls=0;
  const local=await matchExistingImportBySiteId(incoming,{readSiteIds});
  const remote=await matchExistingImportBySiteId(incoming,{readSiteIds,compute:async(kind,payload)=>{
    calls++;assert.ok(payload.candidates.every(row=>!Object.hasOwn(row,'content')));
    return execute(kind,payload);
  }});
  assert.ok(calls>0);assert.deepEqual(remote,local);
  assert.deepEqual(await matchExistingImportBySiteId(incoming,{readSiteIds,compute:async()=>null}),local);
});
test('timestamp comparison preserves microsecond ambiguity and exclusion',async()=>{
  const incoming=rows(600,false),saved=incoming.map((row,i)=>({...row,uid:'b'+String(i).padStart(7,'0')}));
  saved.push({...saved[0],uid:'duplicat'});
  const excludeSavedUids=new Set([saved[1].uid]);
  const readSourceRows=async({consumePage})=>consumePage(saved);
  const local=await matchExistingImportByCreatedAt(incoming,{readSourceRows,excludeSavedUids});
  let calls=0;
  const remote=await matchExistingImportByCreatedAt(incoming,{readSourceRows,excludeSavedUids,compute:async(kind,payload)=>{
    calls++;return execute(kind,payload);
  }});
  assert.ok(calls>0);assert.deepEqual(remote,local);
});
test('unsupported jobs and version mismatches reject',async()=>{
  await assert.rejects(execute('sql',{}));
  await assert.rejects(runComputeJob({protocol:'old',kind:'keyword'}));
});
