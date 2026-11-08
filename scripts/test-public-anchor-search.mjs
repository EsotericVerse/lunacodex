import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  publicPublishedAnchorSuggestions,suggestPublicAnchors,publicKeywordQuery,readPublicAnchorArticles
} from '../app/loc/public-anchor-search.mjs';

test('public autocomplete returns published words without revealing unshared Scope words',()=>{
  const word=publicPublishedAnchorSuggestions(['lo3rwang','lrunes'],'光');
  assert.ok(word.some(row=>row.type==='item'&&row.scopeId==='lo3rwang'));
  assert.ok(word.every(row=>row.scopeId!=='lrunes'||!['item','pattern'].includes(row.type)));
});
test('source entries have published identity and select a searchable field',()=>{
  const source=publicPublishedAnchorSuggestions(['lo3rwang'],'suno').find(row=>row.type==='from');
  assert.ok(source&&/^[A-Za-z0-9]{8}$/.test(source.uid));
});
test('Keyword Item expands its individual Pattern words with OR semantics',()=>{
  const item=publicPublishedAnchorSuggestions(['lo3rwang'],'光').find(row=>row.type==='item');
  assert.ok(Array.isArray(item.terms)&&item.terms.length>1);
  const query=publicKeywordQuery(item);
  assert.match(query,/ \| /);
  assert.ok(query.includes('"'+item.terms[0]+'"'));
});
function mock(rows,spy=()=>{}){
  const proto={
    select(){return this;},eq(){return this;},in(){return this;},
    ilike(){return this;},order(){return this;},limit(){return this;},
    range(){return this;},gte(){return this;},lte(){return this;},
    neq(){return this;},
    then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}
  };
  return {schema(schema){spy(schema);return {from(table){spy(table);return Object.create(proto)}};}};
}
test('date/point candidates are read from already-public Anchor rows',async()=>{
  const rows=await suggestPublicAnchors(['lrunes'],'板橋',{
    client:mock([{uid:'12345678',type:'point',title:'板橋',attr:{},invisible:false}])
  });
  assert.ok(rows.some(row=>row.type==='point'&&row.title==='板橋'));
});
test('published source selection searches Galaxy instead of failed Keyword API',async()=>{
  const source=publicPublishedAnchorSuggestions(['lo3rwang'],'suno')
    .find(row=>row.type==='from');
  const reads=[];
  const result=await readPublicAnchorArticles(source,{},mock([
    {uid:'12345678',title:'作品',site:'suno',search:true}
  ],value=>reads.push(value)));
  assert.equal(result.rows[0].row.uid,'12345678');
  assert.ok(reads.includes('lo3rwang_galaxy'));
  assert.equal(result.hasMore,false);
});
test('unpublished Source choice is rejected',async()=>{
  await assert.rejects(readPublicAnchorArticles({
    scopeId:'lo3rwang',uid:'12345678',type:'from'
  },{},mock([])),/Unpublished Source/);
});
