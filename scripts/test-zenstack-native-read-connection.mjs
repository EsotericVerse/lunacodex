import test from 'node:test';
import assert from 'node:assert/strict';
import {executeNativeRead} from '../zenstack/native-query.mjs';

const request=({head=false}={})=>({
  kind:'query',operation:'select',schema:'silver',
  columns:['uid','title'],filters:[],orders:[],or:[],
  limit:null,offset:0,count:true,head
});

test('ZenStack exact COUNT plus complete SELECT reuse a single transaction connection',async()=>{
  const calls=[];
  const delegate={
    async count({where}){calls.push(['count',where]);return 49674;},
    async findMany(options){calls.push(['rows',options]);return [{uid:'ABCDEFGH',title:'one'}];}
  };
  let transactions=0;
  const client={
    galaxy:delegate,
    async $transaction(fn){
      transactions++;
      return fn({galaxy:delegate});
    }
  };
  const result=await executeNativeRead(client,request(),'Galaxy');
  assert.equal(transactions,1);
  assert.deepEqual(calls.map(([kind])=>kind),['count','rows']);
  assert.deepEqual(calls[0][1],{});
  assert.equal(calls[1][1].take,undefined);
  assert.equal(calls[1][1].skip,0);
  assert.equal(result.count,49674);
  assert.equal(result.data.length,1);
});

test('ZenStack HEAD COUNT uses just one exact aggregation without row load',async()=>{
  let read=0,transactions=0;
  const client={
    galaxy:{
      async count(){return 49674;},
      async findMany(){read++;throw Error('HEAD must not load data');}
    },
    async $transaction(){transactions++;}
  };
  const result=await executeNativeRead(client,request({head:true}),'Galaxy');
  assert.deepEqual(result,{data:null,count:49674});
  assert.equal(read,0);
  assert.equal(transactions,0);
});
