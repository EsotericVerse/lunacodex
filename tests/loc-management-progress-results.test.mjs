import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProgressResult} from '../app/modular/progress-result.mjs';
import {createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';
test('management outcomes publish once at slow midpoint and then final',()=>{
 const values=[{label:'命中',value:5}];
 const args={key:'a',values,completed:40,total:100,elapsed:650};
 assert.equal(selectProgressResult(null,{...args,elapsed:100}),null);
 assert.equal(selectProgressResult(null,{...args,completed:39}),null);
 const mid=selectProgressResult(null,args);
 assert.deepEqual(mid,{key:'a',values,complete:false});
 assert.equal(selectProgressResult(mid,{...args,completed:80,values:[{label:'命中',value:10}]}),mid);
 assert.deepEqual(selectProgressResult(mid,{...args,complete:true,values:[{label:'命中',value:12}]}),{key:'a',complete:true,values:[{label:'命中',value:12}]});
 assert.equal(selectProgressResult(mid,{...args,key:'b',values:[],completed:0}),null);
});
test('discovery reports observed candidate cardinality without sorting a second time',()=>{
 const d=createNewKeywordDiscovery([]);const p=d.consume([{content:'文字建築，文字建築。'}]);
 assert.equal(p.candidateCount,d.finish().candidates.length);
 assert.equal(p.existingCount,0);
});
