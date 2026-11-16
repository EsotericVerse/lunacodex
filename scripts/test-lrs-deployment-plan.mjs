import test from 'node:test';
import assert from 'node:assert/strict';
import {planLrsDeployment} from './plan-lrs-deployment.mjs';

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
