import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createAuthKaraulRateRules,authKaraulRatePolicy
} from '../workers/loc-authority/auth-qos.mjs';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const req=(path,source)=>new Request('https://auth.lo3rwang.cc/api/auth'+path,{
  headers:source?{'cf-connecting-ip':source}:{}
});

test('every original OAuth quota now belongs to the Karaul policy',()=>{
  const rules=createAuthKaraulRateRules({detect:()=>[]});
  const normal={window:60,max:120};
  for(const [path,max] of Object.entries({
    '/oauth2/token':40,
    '/oauth2/authorize':60,
    '/oauth2/introspect':100,
    '/oauth2/revoke':30,
    '/oauth2/register':5,
    '/oauth2/client/rotate-keys':5,
    '/oauth2/userinfo':120
  })){
    assert.deepEqual(rules['/**'](req(path),normal),{window:60,max},path);
  }
  assert.deepEqual(rules['/**'](req('/get-session'),normal),normal);
  // Better Auth's built-in strict sign-in budget must not be weakened.
  assert.deepEqual(rules['/**'](req('/sign-in/social'),{window:10,max:3}),
    {window:10,max:3});
  assert.equal(rules['/jwks'],false);
  assert.equal(authKaraulRatePolicy.enabled,true);
  assert.deepEqual({window:authKaraulRatePolicy.window,max:authKaraulRatePolicy.max},normal);
});

test('Karaul adapts all Auth endpoints per source and per route, then recovers',()=>{
  let now=0;
  const rules=createAuthKaraulRateRules({now:()=>now,detect:()=>[12]});
  const normal={window:60,max:120};
  for(let i=0;i<40;i++)
    assert.deepEqual(rules['/**'](req('/oauth2/token','192.0.2.1'),normal),
      {window:60,max:40});
  now=5000;
  assert.deepEqual(rules['/**'](req('/oauth2/token','192.0.2.1'),normal),
    {window:30,max:1});
  assert.deepEqual(rules['/**'](req('/oauth2/token','192.0.2.1'),normal),
    {window:30,max:1});
  assert.deepEqual(rules['/**'](req('/oauth2/authorize','192.0.2.1'),normal),
    {window:60,max:60},'no false blocking across separate OAuth routes');
  assert.deepEqual(rules['/**'](req('/oauth2/token','192.0.2.2'),normal),
    {window:60,max:40},'unrelated IP unaffected');
  now=35001;
  assert.deepEqual(rules['/**'](req('/oauth2/token','192.0.2.1'),normal),
    {window:60,max:40});
});

test('Karaul analytics errors retain Better Auth native sign-in protection',()=>{
  let now=0;
  const rules=createAuthKaraulRateRules({now:()=>now,detect:()=>{throw Error('temporary');}});
  const normal={window:10,max:3};
  for(let i=0;i<40;i++)
    assert.deepEqual(rules['/**'](req('/sign-in/social','192.0.2.4'),normal),normal);
  now=5000;
  assert.deepEqual(rules['/**'](req('/sign-in/social','192.0.2.4'),normal),normal);
});

test('Auth has one QoS policy and no duplicate limiter or timed polling',()=>{
  const auth=file('workers/loc-authority/auth.mjs');
  const entry=file('workers/loc-authority/index.mjs');
  const qos=file('workers/loc-authority/auth-qos.mjs');
  assert.match(auth,/rateLimit:authKaraulRatePolicy/);
  const provider=auth.slice(auth.indexOf('oauthProvider({'));
  assert.doesNotMatch(provider,/rateLimit\s*:/);
  assert.doesNotMatch(entry,/request-concurrency|authRequestConcurrencyGate|adaptive_qos/);
  assert.doesNotMatch(qos,/setInterval|setTimeout|fetch\(|\.query\(|\.execute\(|new Response/);
});
