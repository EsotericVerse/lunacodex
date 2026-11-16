import test from 'node:test';
import assert from 'node:assert/strict';
import {planLrsDeployment,planLocForLrsRelease} from './plan-lrs-deployment.mjs';

const A='a'.repeat(40),B='b'.repeat(40),M='c'.repeat(64),N='d'.repeat(64);
test('LOC skips LRS when verified deployed code equals desired',()=>{
 const result=planLrsDeployment({desiredSha:A,deployedSha:A,desiredMediaVersion:M,deployedMediaVersion:M});
 assert.equal(result.action,'skip');assert.equal(result.assetsChanged,false);
});
test('LOC requests LRS only when verified game version differs',()=>{
 let result=planLrsDeployment({desiredSha:B,deployedSha:A,desiredMediaVersion:M,deployedMediaVersion:M});
 assert.equal(result.action,'release');assert.equal(result.assetsChanged,false);
 result=planLrsDeployment({desiredSha:B,deployedSha:A,desiredMediaVersion:N,deployedMediaVersion:M});
 assert.equal(result.action,'release');assert.equal(result.assetsChanged,true);
});
test('LOC never infers application SHA from release sourceCommit or Worker version ID',()=>{
 for(const x of [undefined,'main','0612f4d7-338f-472c-a71c-fa646cf72bdb','653fd11d']) {
  assert.throws(()=>planLrsDeployment({desiredSha:A,deployedSha:x}),/unverified/);
 }
 assert.throws(()=>planLrsDeployment({desiredSha:'main',deployedSha:A}),/exact 40-character/);
});
test('an unexpected media delta for an identical game SHA is a hard failure',()=>{
 assert.throws(()=>planLrsDeployment({desiredSha:A,deployedSha:A,desiredMediaVersion:N,deployedMediaVersion:M}),/Inconsistent/);
 assert.throws(()=>planLrsDeployment({desiredSha:A,deployedSha:B,desiredMediaVersion:N}),/Both LRS media versions/);
});

test('LRS ordinary merge or minor/media release never redeploys LOC',()=>{
 for(const releaseKind of ['merge','preview','patch','minor','media','manual','']){
  const result=planLocForLrsRelease({sourceRepo:'EsotericVerse/lunarunes',releaseKind,published:false});
  assert.equal(result.action,'skip',releaseKind);
 }
});
test('LOC only participates in a verified, published major LRS release',()=>{
 const event={sourceRepo:'EsotericVerse/lunarunes',releaseKind:'major',
   published:true,verified:true,releaseTag:'v2.0.0',releaseSha:B,lastIntegratedSha:A};
 assert.equal(planLocForLrsRelease(event).action,'request-loc-deployment');
 assert.equal(planLocForLrsRelease({...event,lastIntegratedSha:B}).action,'skip');
 assert.equal(planLocForLrsRelease({...event,lastIntegratedSha:null}).action,'request-loc-deployment');
});
test('unverified LRS major cannot trigger LOC, even if marked major',()=>{
 const event={sourceRepo:'EsotericVerse/lunarunes',releaseKind:'major',
   published:true,verified:true,releaseTag:'v2.0.0',releaseSha:B,lastIntegratedSha:A};
 assert.throws(()=>planLocForLrsRelease({...event,verified:false}),/independently verified/);
 assert.throws(()=>planLocForLrsRelease({...event,published:false}),/published/);
 assert.throws(()=>planLocForLrsRelease({...event,releaseSha:'main'}),/exact verified Git commit/);
 assert.throws(()=>planLocForLrsRelease({...event,lastIntegratedSha:undefined}),/must be verified/);
 assert.throws(()=>planLocForLrsRelease({...event,sourceRepo:'EsotericVerse/lunarcus'}),/only accept an LRS release/);
});
