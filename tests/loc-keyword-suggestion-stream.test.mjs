import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestKeywordPatterns} from '../app/loc/keywords/sql-service.mjs';

function lucusDatabase(rows){
  const calls=[];
  return {calls,db:{selectFrom(table){
    assert.equal(table,'silver.lo3rwang_lucus');
    const state={conditions:[],columns:[]};
    const query={
      select(columns){state.columns=Array.isArray(columns)?columns:[columns];return query;},
      where(column,operator,value){state.conditions.push([column,operator,value]);return query;},
      orderBy(column,direction){state.order=[column,direction];return query;},
      limit(value){state.limit=value;return query;},
      async execute(){
        calls.push(state.limit);
        let result=rows.filter(row=>state.conditions.every(([column,operator,value])=>
          operator==='='?row[column]===value:operator==='>'?row[column]>value:false));
        result=result.sort((a,b)=>String(a[state.order[0]]).localeCompare(String(b[state.order[0]])));
        result=result.slice(0,state.limit);
        return result.map(row=>Object.fromEntries(state.columns.map(column=>[
          typeof column==='string'?column:column, row[column]
        ])));
      }
    };
    return query;
  }}};
}

test('keyword suggestions stream Item links and Pattern rows through bounded keyset pages',async()=>{
  const patterns=Array.from({length:1105},(_,i)=>({
    uid:'PATT'+String(i).padStart(4,'0'),type:'pattern',
    title:i===1040?'月亮':i===1041?'光月':'無關詞'+i
  }));
  const items=Array.from({length:513},(_,i)=>({
    uid:'ITEM'+String(i).padStart(4,'0'),type:'item',
    attr:JSON.stringify({uid:i===0?['PATT1040','PATT1041']:[]})
  }));
  const {db,calls}=lucusDatabase([...items,...patterns]);
  const result=await suggestKeywordPatterns(db,['lo3rwang'],'月',{
    ownerScopes:new Set(['lo3rwang'])
  });
  assert.deepEqual(result.map(row=>row.pattern),['月亮','光月']);
  assert.ok(calls.includes(512));
  assert.ok(calls.includes(1024));
  assert.ok(calls.every(limit=>limit===512||limit===1024));
});
