import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAuthKaraulRateRules} from '../workers/loc-authority/auth-qos.mjs';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const req=source=>new Request('https://auth.lo3rwang.cc/api/auth/oauth2/token',{
  headers:source?{'cf-connecting-ip':source}:{}
});

test('native Better Auth customRules retain limits unless Karaul observes a sustained spike',()=>{
  let now=0;
  const rules=createAuthKaraulRateRules({now:()=>now,detect:()=>[12]});
  const baseline={window:60,max:40};
  assert.deepEqual(rules['/oauth2/*'](req('192.0.2.1'),baseline),baseline);
  for(let i=0;i<39;i++)rules['/oauth2/*'](req('192.0.2.1'),baseline);
  assert.deepEqual(rules['/oauth2/*'](req('192.0.2.2'),baseline),baseline);
  now=5000;
  assert.deepEqual(rules['/oauth2/*'](req('192.0.2.1'),baseline),
    {window:30,max:1});
  assert.deepEqual(rules['/oauth2/*'](req('192.0.2.1'),baseline),
    {window:30,max:1});
  assert.deepEqual(rules['/oauth2/*'](req('192.0.2.2'),baseline),baseline);
  now=35001;
  assert.deepEqual(rules['/oauth2/*'](req('192.0.2.1'),baseline),baseline);
  assert.deepEqual(rules['/oauth2/*'](req(),baseline),baseline);
  assert.equal(rules['/jwks'],false);
});

test('Karaul analytic exceptions never interrupt login',()=>{
  let now=0;
  const rules=createAuthKaraulRateRules({now:()=>now,detect:()=>{throw Error('temporary');}});
  const baseline={window:10,max:3};
  for(let i=0;i<40;i++)assert.deepEqual(rules['/sign-in/social'](req('192.0.2.4'),baseline),baseline);
  now=5000;
  assert.deepEqual(rules['/sign-in/social'](req('192.0.2.4'),baseline),baseline);
});

test('native Better Auth owns the 429 path, no duplicate gate or timed polling',()=>{
  const auth=file('workers/loc-authority/auth.mjs');
  const entry=file('workers/loc-authority/index.mjs');
  const qos=file('workers/loc-authority/auth-qos.mjs');
  assert.match(auth,/customRules:authKaraulRateRules/);
  assert.doesNotMatch(entry,/request-concurrency|authRequestConcurrencyGate|adaptive_qos/);
  assert.doesNotMatch(qos,/setInterval|setTimeout|fetch\(|\.query\(|\.execute\(|new Response/);
});
