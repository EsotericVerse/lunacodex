import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthRequestConcurrencyGate,requestClass} from
  '../workers/loc-authority/request-concurrency.mjs';

const req=(path,ip)=>new Request('https://auth.lo3rwang.cc'+path,{
  headers:{'cf-connecting-ip':ip}
});

test('request categories keep SSO and public key traffic separate',()=>{
 assert.equal(requestClass('/api/auth/oauth2/token'),'oauth');
 assert.equal(requestClass('/api/auth/sign-in/social'),'oauth');
 assert.equal(requestClass('/api/auth/get-session'),'session');
 assert.equal(requestClass('/api/auth/jwks'),'metadata');
 assert.equal(requestClass('/.well-known/openid-configuration'),'metadata');
 assert.equal(requestClass('/health'),'other');
});

test('in-flight guard throttles one abusive source without revoking JWKS',()=>{
 const gate=createAuthRequestConcurrencyGate({
   maxInFlight:5,perSource:{oauth:1,session:2,metadata:3,other:3}
 });
 const first=gate.acquire(req('/api/auth/oauth2/token','192.0.2.1'));
 assert.equal(first.allowed,true);
 assert.equal(gate.acquire(req('/api/auth/oauth2/authorize','192.0.2.1')).allowed,false);
 const second=gate.acquire(req('/api/auth/oauth2/token','192.0.2.2'));
 assert.equal(second.allowed,true);
 const metadata=gate.acquire(req('/api/auth/jwks','192.0.2.1'));
 assert.equal(metadata.allowed,true);
 assert.equal(gate.snapshot().inflight,3);
 first.release();
 first.release();
 assert.equal(gate.snapshot().inflight,2);
 const after=gate.acquire(req('/api/auth/oauth2/token','192.0.2.1'));
 assert.equal(after.allowed,true);
 after.release();
 metadata.release();
 second.release();
 assert.deepEqual(gate.snapshot(),{inflight:0,sourceKeys:0});
});

test('in-flight global ceiling backpressures even when sources differ',()=>{
 const gate=createAuthRequestConcurrencyGate({
   maxInFlight:2,perSource:{oauth:10,session:10,metadata:10,other:10}
 });
 const a=gate.acquire(req('/api/auth/get-session','192.0.2.1'));
 const b=gate.acquire(req('/api/auth/get-session','192.0.2.2'));
 assert.equal(a.allowed,true);assert.equal(b.allowed,true);
 const denied=gate.acquire(req('/api/auth/jwks','192.0.2.3'));
 assert.equal(denied.allowed,false);
 assert.equal(denied.retryAfterSeconds,2);
 a.release();
 const c=gate.acquire(req('/api/auth/jwks','192.0.2.3'));
 assert.equal(c.allowed,true);
 b.release();c.release();
});
