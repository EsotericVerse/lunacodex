import test from 'node:test';
import assert from 'node:assert/strict';
import {readRuntimeControl,patchRuntimeControl,readDefaultKeywordTemplate,
  validateKeywordTemplate,expandKeywordTemplate,isDataUnavailable,emptyGalaxyFeature,RUNTIME_CONTROL_KEY,RUNTIME_STRUCTURE_KEY}
  from '../app/loc/runtime/r2-runtime.mjs';
const row=(uid,type,children=[],extra={})=>({uid,type,title:type,invisible:false,description:null,
  attr:type==='pattern'?{}:{uid:children,...extra}});
const sample={classUid:'Class001',rows:[
  row('Categor1','category',['Class001']),
  row('Class001','class',['Group001']),
  row('Group001','group',['Item0001'],{total:9}),
  row('Item0001','item',['Pattern1'],{keyword:['word'],total:8}),
  row('Pattern1','pattern')]};
function fakeBucket(){
  const files=new Map();
  let sequence=0;
  return {files,async get(key){const v=files.get(key);return v?{etag:v.etag,size:v.body.length,
    json:async()=>JSON.parse(v.body)}:null;},
    async put(key,body,options={}){const old=files.get(key),cond=options.onlyIf;
      if(cond?.etagMatches&&cond.etagMatches!==old?.etag||cond?.etagDoesNotMatch==='*'&&old)return null;
      const etag=String(++sequence);files.set(key,{body,etag});return {etag};}};
}
test('R2 optional and explicit switch, preserving separate Hyperdrive preference',async()=>{
  const bucket=fakeBucket(),env={LOC_RUNTIME:bucket};
  assert.deepEqual(await readRuntimeControl(env),{version:1,r2Enabled:true,hyperdriveEnabled:true});
  const compact={classUid:sample.classUid,rows:sample.rows.filter(row=>row.type!=='pattern').map(({invisible,...row})=>row),patterns:[['Pattern1','word']]};
  await bucket.put(RUNTIME_STRUCTURE_KEY,JSON.stringify({version:1,keywordTemplate:compact}));
  assert.equal(expandKeywordTemplate(compact).rows.length,5);
  assert.equal(expandKeywordTemplate({...compact,patterns:[]}),null);
  assert.equal((await readDefaultKeywordTemplate(env)).classUid,'Class001');
  assert.equal((await readDefaultKeywordTemplate(env)).rows[2].attr.total,0);
  await patchRuntimeControl({hyperdriveEnabled:false},{env});
  await patchRuntimeControl({r2Enabled:false},{env});
  assert.equal(await readDefaultKeywordTemplate(env),null);
  assert.deepEqual(await readRuntimeControl(env),{version:1,r2Enabled:false,hyperdriveEnabled:false});
  await patchRuntimeControl({r2Enabled:true},{env});
  assert.equal((await readDefaultKeywordTemplate(env)).rows.length,5);
  assert.equal(await readDefaultKeywordTemplate({},async()=>{throw Error('no binding')}),null);
});
test('malformed keyword links cannot seed a new scope',()=>{
  const broken=structuredClone(sample);broken.rows[3].attr.uid=['Missing1'];
  assert.equal(validateKeywordTemplate(broken),null);
  assert.equal(validateKeywordTemplate(sample).rows[3].num,1);
});
test('only typed database availability failures may degrade; never auth errors',()=>{
  assert.equal(isDataUnavailable({code:'42P01'}),true);
  assert.equal(isDataUnavailable({code:'BACKEND_UNAVAILABLE'}),true);
  assert.equal(Boolean(isDataUnavailable({code:'42501',httpStatus:403})),false);
  assert.equal(Boolean(isDataUnavailable(new Error('bug'))),false);
  assert.deepEqual(emptyGalaxyFeature({result:'count'}),{total:0});
  assert.deepEqual(emptyGalaxyFeature({result:'articles',includeTotal:true}),{
    rows:[],hasMore:false,nextCursor:null,totalCount:0});
});
