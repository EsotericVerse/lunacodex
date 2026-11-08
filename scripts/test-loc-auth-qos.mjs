import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {externalAuthQosPolicy,checkExternalAuthQos}
 from '../workers/loc-authority/auth-qos.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const ORIGIN = 'https://auth.lo3rwang.cc';
const request = (path, method='GET', ip='203.0.113.8') =>
  new Request(ORIGIN + path, {method, headers:{'cf-connecting-ip':ip}});
test('LOC Auth QoS classifies OAuth and identity calls, not discovery or preflight', () => {
 assert.deepEqual(externalAuthQosPolicy(request('/oauth/token','POST')),
  {name:'token',limit:30});
 assert.deepEqual(externalAuthQosPolicy(request('/v1/auth/session')),
  {name:'session',limit:120});
 assert.deepEqual(externalAuthQosPolicy(request('/v1/delegation','POST')),
  {name:'delegation',limit:60});
 assert.equal(externalAuthQosPolicy(request('/.well-known/oauth-authorization-server')),null);
 assert.equal(externalAuthQosPolicy(request('/oauth/token','OPTIONS')),null);
});
test('LOC Auth QoS returns only standard HTTP 429 and Retry-After', async () => {
 let calls = 0, keys = new Set();
 const env={LOC_AUTHORITY_STATE:{
   idFromName:name=>name,
   get:name=>{
     keys.add(name);
     return {authQuotaAcquire:async(kind,id,limit)=>{
       assert.equal(kind,'login');
       assert.equal(id.length,64);
       assert.equal(limit,16);
       calls++;
       return calls===1?{allowed:true}:{allowed:false,retryAfter:180};
     }};
   }
 }};
 assert.equal(await checkExternalAuthQos(request('/oauth/login'),env),null);
 const limited=await checkExternalAuthQos(request('/oauth/login'),env);
 assert.equal(limited.status,429);
 assert.equal(limited.headers.get('retry-after'),'180');
 assert.equal(await limited.text(),'');
 assert.equal(keys.size,1);
});
