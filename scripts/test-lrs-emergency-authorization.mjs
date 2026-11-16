import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {emergencySigningPayload,verifyLrsEmergencyAuthorization,
  MAX_EMERGENCY_TTL_SECONDS} from './lrs-emergency-authorization.mjs';

const secret='example-only-verify-not-a-credential';
const now=Date.parse('2026-11-17T01:00:00.000Z');
const SHA1='a'.repeat(40),SHA2='b'.repeat(40);
const signed=(request,key=secret)=>createHmac('sha256',key)
  .update(emergencySigningPayload(request)).digest('hex');
const security={
 schema:'loc.lrs-emergency.v1',reason:'security',repo:'EsotericVerse/lunarunes',
 worker:'lunarunes',desiredSha:SHA2,deployedSha:SHA1,
 workerVersionId:'0612f4d7-338f-472c-a71c-fa646cf72bdb',
 advisoryId:'GHSA-cfgh-jmpq-rvwx',
 issuedAt:'2026-11-17T00:00:00.000Z',expiresAt:'2026-11-17T02:00:00.000Z',
 nonce:'1234567890abcdef1234567890abcdef'
};
function verify(request,options={}){
 return verifyLrsEmergencyAuthorization({
  request,signature:signed(request),secret,now,...options
 });
}
test('A signed critical security request fits existing, strictly bounded TTL',()=>{
 const result=verify(security);
 assert.equal(result.action,'verify-security-before-deploy');
 assert.equal(result.desiredSha,SHA2);
 assert.equal(MAX_EMERGENCY_TTL_SECONDS,21600);
});
test('Bootstrap is separate and cannot be mistaken for a missing permission',()=>{
 const req={...security,reason:'bootstrap',
  deployedSha:null,workerVersionId:null,advisoryId:null};
 assert.equal(verify(req).action,'verify-baseline-before-deploy');
 assert.throws(()=>verify({...req,deployedSha:SHA1}),/verified missing baseline/);
});
test('Expired, future, overlong, and newly shortened TTL all fail closed',()=>{
 assert.throws(()=>verify(security,{now:Date.parse(security.expiresAt)}),/expired/);
 assert.throws(()=>verify(security,{now:Date.parse(security.issuedAt)-1}),/not yet valid/);
 assert.throws(()=>verify(security,{maxTtlSeconds:1800}),/configured TTL/);
 assert.throws(()=>verify(security,{maxTtlSeconds:21601}),/six-hour cap/);
 const long={...security,expiresAt:'2026-11-17T07:00:00.000Z'};
 assert.throws(()=>verify(long),/configured TTL/);
});
test('A secret mismatch or modified event cannot authorize an emergency',()=>{
 assert.throws(()=>verifyLrsEmergencyAuthorization({
   request:security,signature:signed(security),secret:'different-valid-secret',now
 }),/signature mismatch/);
 assert.throws(()=>verifyLrsEmergencyAuthorization({
   request:{...security,desiredSha:SHA1},signature:signed(security),secret,now
 }),/signature mismatch/);
});
test('No grant, renewal, generic release, or wrong Worker in signed request',()=>{
 assert.throws(()=>verify({...security,grant:true}),/no grant or renewal/);
 assert.throws(()=>verify({...security,reason:'major',advisoryId:null}),/owner-approved exact SHA/);
 assert.throws(()=>verify({...security,worker:'loc-authority'}),/unapproved repository/);
 assert.throws(()=>verify({...security,desiredSha:SHA1}),/FIXED revision/);
 assert.throws(()=>verify({...security,workerVersionId:null}),/deployed version/);
 assert.throws(()=>verify({...security,advisoryId:null}),/advisory/);
});
test('No available secret means no emergency authority is silently granted',()=>{
 assert.throws(()=>verifyLrsEmergencyAuthorization({
  request:security,signature:signed(security),secret:'',now
 }),/unavailable/);
});

test('Major LRS publication requires an explicit owner-approved exact SHA, never SemVer inference',()=>{
 const major={...security,reason:'major',advisoryId:null};
 assert.equal(verify(major,{approvedMajorSha:SHA2}).action,'verify-owner-major-release-before-deploy');
 assert.throws(()=>verify(major),/owner-approved exact SHA/);
 assert.throws(()=>verify(major,{approvedMajorSha:SHA1}),/owner-approved exact SHA/);
 assert.throws(()=>verify({...major,advisoryId:security.advisoryId},{approvedMajorSha:SHA2}),/existing deployed version/);
 assert.throws(()=>verify({...major,workerVersionId:null},{approvedMajorSha:SHA2}),/existing deployed version/);
 assert.throws(()=>verify(major,{approvedMajorSha:SHA2,maxTtlSeconds:1800}),/configured TTL/);
});
