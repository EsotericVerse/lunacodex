import test from 'node:test';
import assert from 'node:assert/strict';
import {planLrsDeployment,planLocForLrsRelease} from './plan-lrs-deployment.mjs';

const A='a'.repeat(40),B='b'.repeat(40),M='c'.repeat(64),N='d'.repeat(64);
const baseline={source:'cloudflare-lrs-production',verified:true,status:'missing'};
const incident={source:'github-dependabot-api',verified:true,state:'open',
  advisoryId:'GHSA-cfgh-jmpq-rvwx',affectedSha:A,fixedSha:B,fixVerified:true};
test('Normal LRS version changes NEVER automatically publish LRS or LOC',()=>{
 assert.equal(planLrsDeployment({desiredSha:A,deployedSha:A,desiredMediaVersion:M,deployedMediaVersion:M}).action,'skip');
 const result=planLrsDeployment({desiredSha:B,deployedSha:A,desiredMediaVersion:M,deployedMediaVersion:M});
 assert.equal(result.action,'manual-review');
 assert.equal(result.assetsChanged,false);
 assert.equal(planLrsDeployment({desiredSha:B,deployedSha:A,desiredMediaVersion:N,deployedMediaVersion:M}).action,'manual-review');
 for(const releaseKind of ['merge','preview','patch','minor','media','major','manual','']){
   assert.equal(planLocForLrsRelease({sourceRepo:'EsotericVerse/lunarunes',
     releaseKind,published:true,verified:true,releaseTag:'v2.0.0',
     releaseSha:B,lastIntegratedSha:A}).action,'skip');
 }
});
test('Verified missing LRS baseline is the first exception only',()=>{
 const result=planLrsDeployment({desiredSha:B,deployedSha:null,baseline});
 assert.equal(result.action,'bootstrap-required');
 assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha:null}),/baseline evidence/);
 assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha:null,
   baseline:{...baseline,verified:false}}),/baseline evidence/);
 assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha:undefined,
   baseline}),/unverified/);
});
test('Verified open security alert forces patched LRS update without owner flag',()=>{
 const result=planLrsDeployment({desiredSha:B,deployedSha:A,
   desiredMediaVersion:M,deployedMediaVersion:M,incident});
 assert.equal(result.action,'force-security-release');
 assert.equal(result.assetsChanged,false); // unchanged artwork is fine
 assert.equal(result.advisoryId,incident.advisoryId);
});
test('An alert cannot be forged into force-publishing LRS code',()=>{
 for(const change of [
  {verified:false},{state:'dismissed'},{source:'untrusted-webhook'},
  {advisoryId:'arbitrary-message'},{affectedSha:B},{fixedSha:A},
  {fixVerified:false}
 ]){
  assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha:A,
    incident:{...incident,...change}}),/Unverified or unrelated/);
 }
 assert.throws(()=>planLrsDeployment({desiredSha:A,deployedSha:A,
   incident:{...incident,fixedSha:A}}),/verified FIXED/);
 assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha:null,
   baseline,incident}),/Security update needs/);
});
test('Unknown installed version or inconsistent media data fail closed',()=>{
 for(const deployedSha of [undefined,'main','0612f4d7-338f-472c-a71c-fa646cf72bdb','653fd11d']){
  assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha}),/unverified/);
 }
 assert.throws(()=>planLrsDeployment({desiredSha:'main',deployedSha:A}),/exact 40-character/);
 assert.throws(()=>planLrsDeployment({desiredSha:A,deployedSha:A,
   desiredMediaVersion:N,deployedMediaVersion:M}),/Inconsistent/);
 assert.throws(()=>planLrsDeployment({desiredSha:B,deployedSha:A,
   desiredMediaVersion:N}),/Both LRS media versions/);
});
test('No LRS release kind grants automatic LOC deploy authority',()=>{
 assert.throws(()=>planLocForLrsRelease({sourceRepo:'EsotericVerse/lunarcus',
   releaseKind:'major'}),/only accept an LRS release/);
});
