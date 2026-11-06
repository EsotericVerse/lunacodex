import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const text=readFileSync(new URL('../extensions/loc-channel1/background.js',import.meta.url),'utf8');
const between=(a,b)=>{
 const from=text.indexOf(a),to=text.indexOf(b);
 assert.ok(from>=0&&to>from,'missing extension function '+a);
 return text.slice(from,to);
};
test('DOM extraction uses page content, not highlighted selection',()=>{
 const parse=new Function('document','NodeFilter','getComputedStyle','location',
  between('function parsePage(){','async function capture(')+'return parsePage();');
 const parent={closest:()=>null},nodes=[
  {textContent:'真正內容',parentElement:parent},
  {textContent:'第二段文字',parentElement:parent}
 ];
 let at=0;
 const doc={title:'標題',body:{},querySelector:()=>({}),
  createTreeWalker:()=>({nextNode:()=>nodes[at++]||null})};
 const result=parse(doc,{SHOW_TEXT:4},()=>({display:'block',visibility:'visible'}),
  {href:'https://example.org',hostname:'example.org'});
 assert.equal(result.content,'真正內容\n第二段文字');
 assert.equal(result.source,'example.org');
 assert.equal(result.completeness,'loaded-dom-only');
 assert.equal(text.includes('selectionText'),false);
});
test('batch packing limits number and encoded bytes',()=>{
 const batches=new Function('TextEncoder','MAX_BATCH_BYTES',
  between('function batches(records){','async function stableBatchId(')+'return batches;')(
   TextEncoder,600000);
 const records=Array.from({length:100},(_,i)=>({id:String(i),content:'A'.repeat(10000)}));
 const result=batches(records);
 assert.deepEqual(result.map(b=>b.length),[50,50]);
 for(const b of result)assert.ok(new TextEncoder().encode(JSON.stringify({id:'uuid',records:b})).length<=600000);
});
test('Unicode-safe splitting never truncates long webpages',async()=>{
 const written=[];let seq=0;
 const fn=new Function('MAX_TEXT_CHARS','crypto','enqueue',
  between('async function enqueuePage(record){','function batches(records){')+'return enqueuePage;')(
   140000,{randomUUID:()=>String(++seq)},async item=>written.push(item));
 const content='漢'.repeat(140000)+'😀'+'字'.repeat(140000);
 assert.equal(await fn({content,title:'test'}),3);
 assert.equal(written.map(x=>x.content).join(''),content);
 assert.deepEqual(written.map(x=>x.part_index),[0,1,2]);
 assert.ok(written.every(x=>x.part_count===3));
});
